from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl
import yt_dlp


app = FastAPI(
    title="MediaGrab API",
    version="1.0.0"
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
        acodec = f.get("acodec")
        vcodec = f.get("vcodec")
        filesize = f.get("filesize") or f.get("filesize_approx")
        tbr = f.get("tbr")

        # VIDEO
        if vcodec and vcodec != "none" and height:

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
                    "tbr": tbr
                })

        # AUDIO
        elif acodec and acodec != "none" and not vcodec:

            bitrate = f.get("abr")

            if bitrate:
                quality = f"{round(bitrate)}kbps"
            else:
                quality = "original"

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
                    "acodec": acodec
                })

    # Highest quality first
    video.sort(
        key=lambda x: (
            x.get("height") or 0,
            x.get("fps") or 0
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


@app.get("/")
def root():
    return {
        "name": "MediaGrab API",
        "status": "online"
    }


@app.get("/health")
def health():
    return {
        "status": "ok"
    }


@app.post("/api/info")
def get_info(request: InfoRequest):

    url = str(request.url)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
    }

    try:

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:

            info = ydl.extract_info(
                url,
                download=False
            )

        formats = clean_formats(info)

        return {
            "success": True,
            "title": info.get("title"),
            "thumbnail": info.get("thumbnail"),
            "duration": info.get("duration"),
            "duration_text": info.get("duration_string"),
            "platform": info.get("extractor_key"),
            "webpage_url": info.get("webpage_url"),
            "uploader": info.get("uploader"),
            "view_count": info.get("view_count"),
            "formats": formats,
            "subtitles": list(
                (info.get("subtitles") or {}).keys()
            ),
            "automatic_captions": list(
                (info.get("automatic_captions") or {}).keys()
            )
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": str(e)
            }
              )
