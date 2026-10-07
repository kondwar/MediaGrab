import logging
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

from . import config, db, downloader
from . import formats as fmt
from .admin import require_admin
from .admin import router as admin_router
from .tg_auth import verified_user_id

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)

log = logging.getLogger("mediagrab")

VERSION = config.VERSION

MEDIA_TYPES = ("video", "audio", "subtitles", "text")


@asynccontextmanager
async def lifespan(_app):
    try:
        db.init_db()
    except Exception:
        # Analytics are optional: the downloader keeps working.
        log.exception("Analytics database could not be initialised")

    downloader.sweep_stale_temp_dirs()

    yield


app = FastAPI(
    title="MediaGrab API",
    version=VERSION,
    lifespan=lifespan
)


# =========================================================
# Request models
# =========================================================

class InfoRequest(BaseModel):
    url: HttpUrl


class DownloadRequest(BaseModel):
    url: HttpUrl

    # Required for video / audio (a format_id returned by /api/info).
    format_id: Optional[str] = None

    media_type: str = "video"

    # Audio
    audio_convert: Optional[str] = None
    audio_bitrate: Optional[str] = None
    audio_language: Optional[str] = None

    # Subtitles
    subtitle_lang: Optional[str] = None
    subtitle_auto: bool = False
    subtitle_format: str = "srt"

    # Text
    text_format: str = "txt"


class TrackRequest(BaseModel):
    """A download started on the user's own device (direct mode)."""

    url: HttpUrl
    media_type: str = "video"
    format_id: Optional[str] = None
    quality: Optional[str] = None
    platform: Optional[str] = None


# =========================================================
# Helpers
# =========================================================

def error_detail(error_text, error_type):
    return {
        "success": False,
        "error": error_text,
        "type": error_type
    }


def enforce_platform(url):
    """Reject links from platforms this service does not accept."""

    try:
        fmt.check_platform_allowed(url, config.settings().allowed_platforms)
    except fmt.PlatformNotAllowed as e:
        raise HTTPException(
            status_code=400,
            detail=error_detail(str(e), "UnsupportedPlatform")
        )


def current_user_id(request: Request):
    """
    Telegram user id from a *verified* initData header, else None.
    Values sent by JavaScript are never trusted without the signature.
    """

    init_data = request.headers.get("x-telegram-init-data")

    current = config.settings()

    if not init_data or not current.telegram_bot_token:
        return None

    return verified_user_id(
        init_data,
        current.telegram_bot_token,
        current.initdata_max_age
    )


def _run_command(command):
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=10
        )

        return result.stdout.strip().splitlines()[0] if result.stdout else ""

    except Exception as e:
        return f"unknown: {e}"


def get_ytdlp_version():
    return _run_command([sys.executable, "-m", "yt_dlp", "--version"])


def check_bgutil():
    url = "http://127.0.0.1:4416/ping"

    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            body = response.read().decode("utf-8", errors="replace")

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

@app.get("/", include_in_schema=False)
def root(request: Request):
    """
    The web / Mini App interface. API clients that explicitly ask for JSON
    (Accept: application/json) still get the previous status document.
    """

    accept = request.headers.get("accept", "")

    if "application/json" in accept and "text/html" not in accept:
        return {
            "name": "MediaGrab API",
            "version": VERSION,
            "status": "online"
        }

    return FileResponse(
        config.settings().web_dir / "index.html",
        media_type="text/html",
        headers={"Cache-Control": "no-cache"}
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": VERSION
    }


@app.get("/api/config")
def public_config():
    """Public, non-secret settings the web interface needs."""

    current = config.settings()

    adsgram_ready = current.adsgram_enabled and bool(current.adsgram_block_id)

    if current.adsgram_enabled and not current.adsgram_block_id:
        log.warning(
            "ADSGRAM_ENABLED is true but ADSGRAM_BLOCK_ID is empty: "
            "ads are treated as disabled."
        )

    return {
        "download_mode": current.download_mode,
        "allowed_platforms": list(current.allowed_platforms),
        "adsgram": {
            "enabled": adsgram_ready,
            "block_id": current.adsgram_block_id if adsgram_ready else "",
            "fail_mode": current.adsgram_fail_mode,
            "sdk_url": current.adsgram_sdk_url if adsgram_ready else ""
        },
        "telegram": {
            "auth_configured": bool(current.telegram_bot_token)
        }
    }


@app.get("/api/debug/youtube")
def youtube_debug(_: bool = Depends(require_admin)):

    return {
        "status": "ok",
        "yt_dlp": get_ytdlp_version(),
        "python": sys.version,
        "node": _run_command(["node", "--version"]),
        "ffmpeg": (
            _run_command(["ffmpeg", "-version"])
            if shutil.which("ffmpeg") else "not installed"
        ),
        "bgutil": check_bgutil(),
        "configuration": {
            "js_runtime": "node",
            "ejs": True,
            "bgutil_http": True,
            "bgutil_url": "http://127.0.0.1:4416"
        }
    }


@app.post("/api/info")
def get_info(request: InfoRequest, http_request: Request):

    url = str(request.url)

    enforce_platform(url)

    user_id = current_user_id(http_request)

    started = time.time()

    platform = None

    try:
        info = downloader.resolve_entry(downloader.extract_info(url))

        platform = info.get("extractor_key")

        downloader.cache_put(url, info)

        direct = config.settings().download_mode == "direct"

        formats = fmt.clean_formats(info, include_direct=direct)

        elapsed = round(time.time() - started, 3)

        db.safe_record_event(
            action="info",
            success=True,
            telegram_user_id=user_id,
            platform=platform,
            url=url,
            processing_time=elapsed
        )

        return {
            "success": True,
            "title": info.get("title"),
            "thumbnail": info.get("thumbnail"),
            "duration": info.get("duration"),
            "duration_text": info.get("duration_string"),
            "platform": platform,
            "webpage_url": info.get("webpage_url"),
            "uploader": info.get("uploader"),
            "view_count": info.get("view_count"),
            "formats": formats,
            "audio_languages": fmt.audio_languages(info),
            "subtitles": list((info.get("subtitles") or {}).keys()),
            "automatic_captions": list(
                (info.get("automatic_captions") or {}).keys()
            ),
            "subtitle_tracks": fmt.subtitle_tracks(
                info, include_urls=direct
            ),
            "mode": "direct" if direct else "server",
            "description": info.get("description") if direct else None,
            "processing_time": elapsed
        }

    except Exception as e:
        error_text = downloader.clean_error_text(e)

        log.exception("info failed for %s", url)

        db.safe_record_event(
            action="info",
            success=False,
            telegram_user_id=user_id,
            platform=platform,
            url=url,
            error_type=type(e).__name__,
            processing_time=round(time.time() - started, 3)
        )

        raise HTTPException(
            status_code=400,
            detail=error_detail(error_text, type(e).__name__)
        )


@app.post("/api/track")
def track_download(request: TrackRequest, http_request: Request):
    """
    Direct mode: the file is downloaded by the user's device, so the
    server only records that a download was started (for analytics).
    """

    if request.media_type not in MEDIA_TYPES:
        raise HTTPException(
            status_code=400,
            detail=error_detail("Unsupported media_type.", "InvalidMediaType")
        )

    enforce_platform(str(request.url))

    db.safe_record_event(
        action="download",
        success=True,
        telegram_user_id=current_user_id(http_request),
        platform=(request.platform or "")[:40] or None,
        url=str(request.url),
        media_type=request.media_type,
        format_id=(request.format_id or "")[:200] or None,
        quality=(request.quality or "")[:40] or None
    )

    return {"success": True}


@app.post("/api/download")
def download_media(request: DownloadRequest, http_request: Request):

    if config.settings().download_mode != "server":
        raise HTTPException(
            status_code=403,
            detail=error_detail(
                "Server-side downloads are not available in this version. "
                "Use the direct download links.",
                "ServerDownloadsDisabled"
            )
        )

    url = str(request.url)

    enforce_platform(url)

    media_type = request.media_type

    if media_type not in MEDIA_TYPES:
        raise HTTPException(
            status_code=400,
            detail=error_detail("Unsupported media_type.", "InvalidMediaType")
        )

    format_id = (request.format_id or "").strip()

    # Validate before creating anything on disk.
    if media_type in ("video", "audio") and not fmt.valid_format_id(format_id):
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Invalid format_id. Use a format_id returned by /api/info.",
                "InvalidFormatId"
            )
        )

    user_id = current_user_id(http_request)

    started = time.time()

    temp_dir = None
    result = None

    try:
        with downloader.download_slot():

            temp_dir = downloader.new_temp_dir()

            log.info(
                "download url=%s type=%s format_id=%s",
                url, media_type, format_id
            )

            if media_type in ("video", "audio"):
                result = downloader.download_av(
                    url,
                    temp_dir,
                    format_id,
                    media_type=media_type,
                    audio_convert=request.audio_convert,
                    audio_bitrate=request.audio_bitrate,
                    audio_language=request.audio_language
                )

            elif media_type == "subtitles":
                result = downloader.download_subtitles(
                    url,
                    temp_dir,
                    request.subtitle_lang,
                    auto=request.subtitle_auto,
                    subtitle_format=request.subtitle_format
                )

            else:
                result = downloader.export_text(
                    url,
                    temp_dir,
                    text_format=request.text_format
                )

        file_size = os.path.getsize(result.path)

        db.safe_record_event(
            action="download",
            success=True,
            telegram_user_id=user_id,
            platform=result.platform,
            url=url,
            media_type=media_type,
            format_id=format_id or None,
            quality=result.quality,
            processing_time=round(time.time() - started, 3),
            file_size=file_size
        )

        # The temporary folder (original video, audio, intermediates and
        # the final file) is removed after the response has been fully sent.
        return FileResponse(
            path=result.path,
            filename=result.filename,
            media_type=result.media_type,
            headers={"Cache-Control": "no-store"},
            background=BackgroundTask(downloader.remove_directory, temp_dir)
        )

    except downloader.BusyError as e:
        if temp_dir:
            downloader.remove_directory(temp_dir)

        raise HTTPException(
            status_code=503,
            detail=error_detail(str(e), "Busy")
        )

    except Exception as e:
        if temp_dir:
            downloader.remove_directory(temp_dir)

        error_text = downloader.clean_error_text(e)

        log.exception("download failed for %s", url)

        db.safe_record_event(
            action="download",
            success=False,
            telegram_user_id=user_id,
            url=url,
            media_type=media_type,
            format_id=format_id or None,
            error_type=type(e).__name__,
            processing_time=round(time.time() - started, 3)
        )

        raise HTTPException(
            status_code=400,
            detail=error_detail(error_text, type(e).__name__)
        )


# =========================================================
# Admin and static files (the "/" mount must stay last)
# =========================================================

app.include_router(admin_router)

app.mount(
    "/translations",
    StaticFiles(directory=str(config.settings().translations_dir)),
    name="translations"
)

app.mount(
    "/",
    StaticFiles(directory=str(config.settings().web_dir), html=True),
    name="web"
)
