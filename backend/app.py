from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl
import yt_dlp
import subprocess
import urllib.request
import json
import os
import time


app = FastAPI(
    title="MediaGrab API",
    version="1.1.0"
)


class InfoRequest(BaseModel):
    url: HttpUrl


def format_size(size):
    if not size:
        return None

    if size >= 1024 ** 3:
        return f"{size / (1024 ** 3):.2f} GB"

    if size >= 1024 ** 2:
        return f"{size / (1024 ** 2):.2f} MB"

    if size >= 1024:
        return f"{size / 1024:.2f} KB"

    return f"{size} B"


def clean_formats(info):
    video = []
    audio = []

    seen_video = set()
    seen_audio = set()

    for f in info.get("formats", []):
        format_id = f.get("format_id")

        if not format_id:
            continue

        ext = f.get("ext")
        height = f.get("height")
        width = f.get("width")

        vcodec = f.get("vcodec")
        acodec = f.get("acodec")

        filesize = (
            f.get("filesize")
            or f.get("filesize_approx")
        )

        tbr = f.get("tbr")

        # -------------------------
        # VIDEO
        # -------------------------
        if (
            vcodec
            and vcodec != "none"
            and height
        ):
            quality = f"{height}p"

            key = (
                quality,
                ext,
                format_id
            )

            if key not in seen_video:
                seen_video.add(key)

                video.append({
                    "format_id": format_id,
                    "quality": quality,
                    "format": ext,
                    "width": width,
                    "height": height,
                    "fps": f.get("fps"),
                    "filesize": filesize,
                    "filesize_text": format_size(filesize),
                    "vcodec": vcodec,
                    "acodec": acodec,
                    "tbr": tbr,
                    "url": f.get("url")
                })

        # -------------------------
        # AUDIO
        # -------------------------
        elif (
            acodec
            and acodec != "none"
            and not vcodec
        ):
            bitrate = f.get("abr")

            quality = (
                f"{round(bitrate)}kbps"
                if bitrate
                else "original"
            )

            key = (
                quality,
                ext,
                format_id
            )

            if key not in seen_audio:
                seen_audio.add(key)

                audio.append({
                    "format_id": format_id,
                    "quality": quality,
                    "format": ext,
                    "bitrate": bitrate,
                    "filesize": filesize,
                    "filesize_text": format_size(filesize),
                    "acodec": acodec,
                    "url": f.get("url")
                })

    video.sort(
        key=lambda x: (
            x.get("height") or 0,
            x.get("fps") or 0,
            x.get("tbr") or 0
        ),
        reverse=True
    )

    audio.sort(
        key=lambda x: x.get("bitrate") or 0,
        reverse=True
    )

    return {
        "video": video,
        "audio": audio
    }


def get_yt_dlp_options():
    """
    Current YouTube configuration.

    Important:
    - Node >=22 is installed in Docker.
    - yt-dlp-ejs is installed.
    - bgutil provider is installed through pip.
    - bgutil HTTP server runs on 127.0.0.1:4416.
    """

    return {
        "quiet": True,
        "no_warnings": False,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,

        # Current JS challenge solver.
        "js_runtimes": {
            "node": None
        },

        # Allow yt-dlp to use its EJS components.
        "remote_components": {
            "ejs": ["npm"]
        },

        # YouTube clients.
        #
        # mweb is included because the current PO Token
        # documentation specifically recommends PO Tokens
        # for mweb GVS requests.
        "extractor_args": {
            "youtube": {
                "player_client": [
                    "mweb",
                    "web_embedded",
                    "tv"
                ]
            },

            # bgutil HTTP provider
            "youtubepot-bgutilhttp": {
                "base_url": "http://127.0.0.1:4416"
            }
        }
    }


def extract_info(url):
    options = get_yt_dlp_options()

    with yt_dlp.YoutubeDL(options) as ydl:
        return ydl.extract_info(
            url,
            download=False
        )


def get_ytdlp_version():
    try:
        result = subprocess.run(
            [
                "python",
                "-m",
                "yt_dlp",
                "--version"
            ],
            capture_output=True,
            text=True,
            timeout=10
        )

        return result.stdout.strip()

    except Exception as e:
        return f"unknown: {e}"


def check_bgutil():
    """
    Check whether the local bgutil provider server
    is actually reachable.
    """

    url = "http://127.0.0.1:4416/ping"

    try:
        with urllib.request.urlopen(
            url,
            timeout=3
        ) as response:

            body = response.read().decode(
                "utf-8",
                errors="replace"
            )

            return {
                "reachable": True,
                "status": response.status,
                "response": body
            }

    except Exception as e:
        return {
            "reachable": False,
            "error": str(e)
        }


def get_python_version():
    import sys
    return sys.version


@app.get("/")
def root():
    return {
        "name": "MediaGrab API",
        "version": "1.1.0",
        "status": "online"
    }


@app.get("/health")
def health():
    return {
        "status": "ok"
    }


@app.get("/api/debug/youtube")
def youtube_debug():
    """
    Diagnostic endpoint.

    This does NOT download anything.
    It verifies the components required by the
    current YouTube extraction setup.
    """

    bgutil = check_bgutil()

    return {
        "status": "ok",

        "yt_dlp": get_ytdlp_version(),

        "python": get_python_version(),

        "node": os.popen(
            "node --version 2>/dev/null"
        ).read().strip(),

        "ffmpeg": os.popen(
            "ffmpeg -version 2>/dev/null | head -n 1"
        ).read().strip(),

        "bgutil": bgutil,

        "configuration": {
            "js_runtime": "node",
            "ejs": True,
            "bgutil_http": True,
            "bgutil_url": (
                "http://127.0.0.1:4416"
            )
        }
    }


@app.post("/api/info")
def get_info(request: InfoRequest):

    url = str(request.url)

    started = time.time()

    try:

        info = extract_info(url)

        formats = clean_formats(info)

        elapsed = round(
            time.time() - started,
            3
        )

        return {
            "success": True,

            "title": info.get("title"),

            "thumbnail": info.get(
                "thumbnail"
            ),

            "duration": info.get(
                "duration"
            ),

            "duration_text": info.get(
                "duration_string"
            ),

            "platform": info.get(
                "extractor_key"
            ),

            "webpage_url": info.get(
                "webpage_url"
            ),

            "uploader": info.get(
                "uploader"
            ),

            "view_count": info.get(
                "view_count"
            ),

            "formats": formats,

            "subtitles": list(
                (
                    info.get("subtitles")
                    or {}
                ).keys()
            ),

            "automatic_captions": list(
                (
                    info.get(
                        "automatic_captions"
                    )
                    or {}
                ).keys()
            ),

            "processing_time": elapsed
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": str(e)
            }
        )


# -----------------------------------------
# Static frontend
# -----------------------------------------

app.mount(
    "/",
    StaticFiles(
        directory="/app/web",
        html=True
    ),
    name="web"
            )
