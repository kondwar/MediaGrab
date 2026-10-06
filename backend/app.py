from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl
import yt_dlp
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import unicodedata
import urllib.request


VERSION = "1.3.0"

app = FastAPI(
    title="MediaGrab API",
    version=VERSION
)


# =========================================================
# Request models
# =========================================================

class InfoRequest(BaseModel):
    url: HttpUrl


class DownloadRequest(BaseModel):
    url: HttpUrl
    format_id: str


# =========================================================
# Helpers
# =========================================================

ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

# Characters that yt-dlp would interpret as format-selector syntax.
# A real format_id returned by /api/info never needs them.
FORMAT_ID_FORBIDDEN = re.compile(r"[\s/+,\[\]()*|]")

# Partial / temporary files yt-dlp may leave in the temp folder.
TEMP_SUFFIXES = (".part", ".ytdl", ".temp", ".tmp")


def clean_error_text(text):

    return ANSI_PATTERN.sub(
        "",
        str(text)
    ).strip()


def error_detail(error_text, error_type):

    return {
        "success": False,
        "error": error_text,
        "type": error_type
    }


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


def resolve_entry(info):
    """
    If yt-dlp returns a playlist-like result, use its first
    real entry. Single videos are returned unchanged.
    """

    if not info:
        return info

    entries = info.get("entries")

    if entries and not info.get("formats"):

        for entry in entries:

            if entry:
                return entry

    return info


def sanitize_filename(title, max_length=100):

    text = unicodedata.normalize(
        "NFKC",
        str(title or "")
    )

    # Remove control characters.
    text = "".join(
        ch for ch in text
        if unicodedata.category(ch)[0] != "C"
    )

    # Remove characters that are unsafe in file names.
    text = re.sub(
        r'[\\/:*?"<>|\x00-\x1f]',
        " ",
        text
    )

    # Collapse whitespace.
    text = re.sub(r"\s+", " ", text).strip()

    # No leading / trailing dots or spaces.
    text = text.strip(". ")

    if len(text) > max_length:
        text = text[:max_length].rstrip(". ")

    return text or "media"


def remove_directory(path):

    shutil.rmtree(
        path,
        ignore_errors=True
    )


def find_downloaded_file(directory):

    candidates = []

    for name in os.listdir(directory):

        if not name.startswith("media."):
            continue

        if name.endswith(TEMP_SUFFIXES):
            continue

        full_path = os.path.join(directory, name)

        if os.path.isfile(full_path):
            candidates.append(full_path)

    if not candidates:
        return None

    # If several files exist, the real output is the largest one.
    candidates.sort(
        key=os.path.getsize,
        reverse=True
    )

    return candidates[0]


# =========================================================
# Format cleaning (built from the real yt-dlp formats)
# =========================================================

def clean_formats(info):

    if not info:
        return {
            "video": [],
            "audio": []
        }

    video = []
    audio = []

    seen_video = set()
    seen_audio = set()

    for f in info.get("formats") or []:

        format_id = f.get("format_id")

        if not format_id:
            continue

        # Skip storyboards / thumbnail sheets.
        if f.get("protocol") == "mhtml":
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

        has_video = (
            vcodec != "none"
            and bool(vcodec or height)
        )

        has_audio = (
            acodec not in (None, "none")
        )

        # -------------------------
        # VIDEO
        # (some platforms do not report vcodec, so a known
        # height is also accepted as a video stream)
        # -------------------------

        if has_video:

            quality = (
                f"{height}p"
                if height
                else "unknown"
            )

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
                    "has_audio": has_audio,
                    "tbr": tbr,
                    "format_note": f.get("format_note"),
                    "protocol": f.get("protocol"),
                    "url": f.get("url")
                })

        # -------------------------
        # AUDIO ONLY
        # -------------------------

        elif has_audio:

            bitrate = f.get("abr") or tbr

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
                    "tbr": tbr,
                    "filesize": filesize,
                    "filesize_text": format_size(filesize),
                    "acodec": acodec,
                    "vcodec": vcodec,
                    "format_note": f.get("format_note"),
                    "protocol": f.get("protocol"),
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


# =========================================================
# yt-dlp configuration
# =========================================================

def get_yt_dlp_options():

    return {

        "quiet": False,

        "no_warnings": False,

        "skip_download": True,

        "noplaylist": True,

        "extract_flat": False,

        # JavaScript runtime
        "js_runtimes": {
            "node": {
                "path": "/usr/local/bin/node"
            }
        },

        # yt-dlp EJS
        "remote_components": [
            "ejs:npm"
        ],

        # YouTube clients
        "extractor_args": {

            "youtube": {

                "player_client": [
                    "mweb",
                    "web_embedded",
                    "tv"
                ]

            },

            "youtubepot-bgutilhttp": {

                "base_url":
                    "http://127.0.0.1:4416"

            }

        }

    }


def get_download_options(format_id, directory):

    options = get_yt_dlp_options()

    options["skip_download"] = False

    options["format"] = format_id

    options["outtmpl"] = os.path.join(
        directory,
        "media.%(ext)s"
    )

    return options


def extract_info(url):

    options = get_yt_dlp_options()

    print(
        "\n========================================"
    )

    print("MediaGrab extraction")

    print(
        "URL:",
        url
    )

    try:

        print(
            "yt-dlp:",
            yt_dlp.version.__version__
        )

    except Exception:

        print("yt-dlp: unknown")

    print(
        "========================================\n"
    )

    with yt_dlp.YoutubeDL(options) as ydl:

        info = ydl.extract_info(
            url,
            download=False
        )

        if info is None:

            raise RuntimeError(
                "yt-dlp returned no information. "
                "Check the Blitz deployment logs "
                "for the actual extractor error."
            )

        return info


# =========================================================
# Diagnostics
# =========================================================

def get_ytdlp_version():

    try:

        result = subprocess.run(
            [
                sys.executable,
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

    url = (
        "http://127.0.0.1:4416/ping"
    )

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


# =========================================================
# Routes
# =========================================================

@app.get("/")
def root():

    return {
        "name": "MediaGrab API",
        "version": VERSION,
        "status": "online"
    }


@app.get("/health")
def health():

    return {
        "status": "ok",
        "version": VERSION
    }


@app.get("/api/debug/youtube")
def youtube_debug():

    return {

        "status": "ok",

        "yt_dlp":
            get_ytdlp_version(),

        "python":
            sys.version,

        "node":
            os.popen(
                "node --version 2>/dev/null"
            ).read().strip(),

        "ffmpeg":
            os.popen(
                "ffmpeg -version 2>/dev/null "
                "| head -n 1"
            ).read().strip(),

        "bgutil":
            check_bgutil(),

        "configuration": {

            "js_runtime":
                "node",

            "ejs":
                True,

            "bgutil_http":
                True,

            "bgutil_url":
                "http://127.0.0.1:4416"

        }

    }


@app.post("/api/info")
def get_info(
    request: InfoRequest
):

    url = str(request.url)

    started = time.time()

    try:

        info = resolve_entry(
            extract_info(url)
        )

        formats = clean_formats(info)

        elapsed = round(
            time.time() - started,
            3
        )

        return {

            "success": True,

            "title":
                info.get("title"),

            "thumbnail":
                info.get("thumbnail"),

            "duration":
                info.get("duration"),

            "duration_text":
                info.get("duration_string"),

            "platform":
                info.get("extractor_key"),

            "webpage_url":
                info.get("webpage_url"),

            "uploader":
                info.get("uploader"),

            "view_count":
                info.get("view_count"),

            "formats":
                formats,

            "subtitles":
                list(
                    (
                        info.get("subtitles")
                        or {}
                    ).keys()
                ),

            "automatic_captions":
                list(
                    (
                        info.get(
                            "automatic_captions"
                        )
                        or {}
                    ).keys()
                ),

            "processing_time":
                elapsed

        }

    except Exception as e:

        error_text = clean_error_text(e)

        print(
            "\n========== MEDIAGRAB ERROR =========="
        )

        print(error_text)

        traceback.print_exc()

        print(
            "=====================================\n"
        )

        raise HTTPException(

            status_code=400,

            detail=error_detail(
                error_text,
                type(e).__name__
            )

        )


@app.post("/api/download")
def download_media(
    request: DownloadRequest,
    background_tasks: BackgroundTasks
):

    url = str(request.url)

    format_id = request.format_id.strip()

    # Validate the format_id before creating anything on disk.
    if (
        not format_id
        or len(format_id) > 200
        or FORMAT_ID_FORBIDDEN.search(format_id)
    ):

        raise HTTPException(

            status_code=400,

            detail=error_detail(
                "Invalid format_id. Use a format_id "
                "returned by /api/info.",
                "InvalidFormatId"
            )

        )

    temp_dir = tempfile.mkdtemp(
        prefix="mediagrab_"
    )

    try:

        options = get_download_options(
            format_id,
            temp_dir
        )

        print(
            "\n========================================"
        )

        print("MediaGrab download")

        print(
            "URL:",
            url
        )

        print(
            "format_id:",
            format_id
        )

        print(
            "========================================\n"
        )

        with yt_dlp.YoutubeDL(options) as ydl:

            info = ydl.extract_info(
                url,
                download=True
            )

        if info is None:

            raise RuntimeError(
                "yt-dlp returned no information "
                "for this download."
            )

        info = resolve_entry(info)

        file_path = find_downloaded_file(
            temp_dir
        )

        if not file_path:

            raise RuntimeError(
                "Download finished but no output "
                "file was found."
            )

        extension = os.path.splitext(
            file_path
        )[1]

        download_name = (
            sanitize_filename(
                info.get("title")
            )
            + extension
        )

        media_type = (
            mimetypes.guess_type(
                download_name
            )[0]
            or "application/octet-stream"
        )

        # The temporary folder is deleted after the
        # response has been fully sent to the browser.
        background_tasks.add_task(
            remove_directory,
            temp_dir
        )

        return FileResponse(
            path=file_path,
            filename=download_name,
            media_type=media_type,
            headers={
                "Cache-Control": "no-store"
            }
        )

    except Exception as e:

        remove_directory(temp_dir)

        error_text = clean_error_text(e)

        print(
            "\n========== MEDIAGRAB DOWNLOAD ERROR =========="
        )

        print(error_text)

        traceback.print_exc()

        print(
            "==============================================\n"
        )

        raise HTTPException(

            status_code=400,

            detail=error_detail(
                error_text,
                type(e).__name__
            )

        )


# =========================================================
# Static files
# =========================================================

app.mount(
    "/translations",
    StaticFiles(directory="/app/translations"),
    name="translations"
)

app.mount(
    "/",
    StaticFiles(
        directory="/app/web",
        html=True
    ),
    name="web"
)
