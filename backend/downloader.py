"""
yt-dlp integration: extraction, download, FFmpeg merge, subtitles, text.

yt-dlp is imported lazily so the pure logic and its tests do not need it.
Merging is done by yt-dlp itself, which calls the FFmpeg installed in the
Docker image (stream copy; no re-encoding).
"""

import logging
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import time
import unicodedata
from contextlib import contextmanager
from dataclasses import dataclass

from . import config
from . import formats as fmt

log = logging.getLogger("mediagrab.downloader")

TEMP_PREFIX = "mediagrab_"

# Partial / temporary files yt-dlp may leave in the temp folder.
TEMP_SUFFIXES = (".part", ".ytdl", ".temp", ".tmp")

# Formats are kept briefly between /api/info and /api/download so the
# download does not need a second extraction just to plan the merge.
INFO_CACHE_TTL = 300
INFO_CACHE_MAX = 50

CACHE_KEYS = (
    "format_id", "ext", "vcodec", "acodec", "abr", "tbr", "height",
    "width", "fps", "language", "language_preference", "protocol",
    "format_note",
)

_cache = {}
_cache_lock = threading.Lock()

_slots = None
_slots_lock = threading.Lock()


class BusyError(RuntimeError):
    """All download slots are in use."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def clean_error_text(text):
    return ANSI_PATTERN.sub("", str(text)).strip()


def sanitize_filename(title, max_length=100):
    text = unicodedata.normalize("NFKC", str(title or ""))

    # Remove control characters.
    text = "".join(
        ch for ch in text if unicodedata.category(ch)[0] != "C"
    )

    # Remove characters that are unsafe in file names.
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", text)

    # Collapse whitespace.
    text = re.sub(r"\s+", " ", text).strip()

    # No leading / trailing dots or spaces.
    text = text.strip(". ")

    if len(text) > max_length:
        text = text[:max_length].rstrip(". ")

    return text or "media"


def resolve_entry(info):
    """
    If yt-dlp returns a playlist-like result, use its first real entry.
    Single videos are returned unchanged.
    """

    if not info:
        return info

    entries = info.get("entries")

    if entries and not info.get("formats"):
        for entry in entries:
            if entry:
                return entry

    return info


def remove_directory(path):
    shutil.rmtree(path, ignore_errors=True)


def sweep_stale_temp_dirs(max_age=3600):
    """
    Safety net: remove temp folders left behind (for example when a client
    disconnected before the response finished).
    """

    base = tempfile.gettempdir()
    cutoff = time.time() - max_age

    try:
        names = os.listdir(base)
    except OSError:
        return

    for name in names:
        if not name.startswith(TEMP_PREFIX):
            continue

        path = os.path.join(base, name)

        try:
            if os.path.isdir(path) and os.path.getmtime(path) < cutoff:
                remove_directory(path)
        except OSError:
            continue


def new_temp_dir():
    sweep_stale_temp_dirs()

    return tempfile.mkdtemp(prefix=TEMP_PREFIX)


@contextmanager
def download_slot():
    """Limit simultaneous downloads (CPU / disk / bandwidth protection)."""

    global _slots

    with _slots_lock:
        if _slots is None:
            _slots = threading.BoundedSemaphore(
                config.settings().max_concurrent_downloads
            )

    if not _slots.acquire(blocking=False):
        raise BusyError(
            "The server is busy with other downloads. Try again shortly."
        )

    try:
        yield
    finally:
        _slots.release()


def find_downloaded_file(directory, prefer_ext=None):
    names = os.listdir(directory)

    if prefer_ext:
        wanted = f"media.{prefer_ext}"

        if wanted in names and os.path.isfile(os.path.join(directory, wanted)):
            return os.path.join(directory, wanted)

    candidates = []

    for name in names:
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
    candidates.sort(key=os.path.getsize, reverse=True)

    return candidates[0]


# ---------------------------------------------------------------------------
# yt-dlp configuration
# ---------------------------------------------------------------------------

def get_yt_dlp_options():
    node_path = shutil.which("node") or "/usr/local/bin/node"

    return {
        "quiet": False,
        "no_warnings": False,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,

        # JavaScript runtime
        "js_runtimes": {
            "node": {
                "path": node_path
            }
        },

        # yt-dlp EJS
        "remote_components": ["ejs:npm"],

        # YouTube clients + bgutil PO token provider
        "extractor_args": {
            "youtube": {
                "player_client": ["mweb", "web_embedded", "tv"]
            },
            "youtubepot-bgutilhttp": {
                "base_url": "http://127.0.0.1:4416"
            }
        }
    }


def _import_yt_dlp():
    import yt_dlp

    return yt_dlp


def extract_info(url):
    yt_dlp = _import_yt_dlp()

    options = get_yt_dlp_options()

    try:
        version = yt_dlp.version.__version__
    except Exception:
        version = "unknown"

    log.info("extraction url=%s yt-dlp=%s", url, version)

    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)

        if info is None:
            raise RuntimeError(
                "yt-dlp returned no information. Check the deployment "
                "logs for the actual extractor error."
            )

        return info


# ---------------------------------------------------------------------------
# Format cache
# ---------------------------------------------------------------------------

def cache_put(url, info):
    minimal = [
        {key: f.get(key) for key in CACHE_KEYS}
        for f in fmt.usable_formats(info)
    ]

    with _cache_lock:
        if len(_cache) >= INFO_CACHE_MAX:
            oldest = min(_cache, key=lambda k: _cache[k][0])
            _cache.pop(oldest, None)

        _cache[url] = (time.time(), minimal)


def formats_for(url):
    """Real formats for the URL: cached from /api/info, else extracted."""

    with _cache_lock:
        entry = _cache.get(url)

    if entry and time.time() - entry[0] < INFO_CACHE_TTL:
        return entry[1]

    info = resolve_entry(extract_info(url))

    cache_put(url, info)

    return [
        {key: f.get(key) for key in CACHE_KEYS}
        for f in fmt.usable_formats(info)
    ]


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

@dataclass
class DownloadResult:
    path: str
    filename: str
    media_type: str
    quality: str
    platform: str


def _result(path, info, quality, mime=None):
    extension = os.path.splitext(path)[1]

    filename = sanitize_filename(info.get("title")) + extension

    return DownloadResult(
        path=path,
        filename=filename,
        media_type=(
            mime
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream"
        ),
        quality=quality,
        platform=info.get("extractor_key") or "unknown",
    )


def _base_download_options(directory):
    options = get_yt_dlp_options()

    options["skip_download"] = False
    options["outtmpl"] = os.path.join(directory, "media.%(ext)s")

    limit = config.settings().max_filesize_mb

    if limit:
        options["max_filesize"] = limit * 1024 * 1024

    return options


def _run(options, url):
    yt_dlp = _import_yt_dlp()

    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)

    if info is None:
        raise RuntimeError("yt-dlp returned no information for this download.")

    return resolve_entry(info)


def download_av(
    url,
    directory,
    format_id,
    media_type="video",
    audio_convert=None,
    audio_bitrate=None,
    audio_language=None,
):
    """
    Video (direct or merged) and audio downloads.

      combined format      -> downloaded as is
      video-only format    -> best matching audio found dynamically and
                              merged by yt-dlp through FFmpeg
      audio-only format    -> downloaded as is, or converted when
                              audio_convert is requested
    """

    plan = fmt.plan_download(
        formats_for(url),
        format_id,
        prefer_language=audio_language
    )

    options = _base_download_options(directory)
    options["format"] = plan["selector"]

    expected_ext = None

    if plan["mode"] == "merge":
        options["merge_output_format"] = plan["container"]
        expected_ext = plan["container"]

    quality = plan["quality"]

    if media_type == "audio":
        if audio_convert and audio_convert not in fmt.SUPPORTED_AUDIO_CONVERSIONS:
            raise fmt.FormatError("Unsupported audio conversion.")

        if plan["mode"] != "audio" and not audio_convert:
            raise fmt.FormatError(
                "This source has no separate audio stream. "
                "Choose an audio format to convert to."
            )

        source_ext = (plan["source"].get("ext") or "").lower()

        if audio_convert and audio_convert != source_ext:
            processor = {
                "key": "FFmpegExtractAudio",
                "preferredcodec": audio_convert,
            }

            if audio_convert == "mp3":
                bitrate = (
                    audio_bitrate
                    if audio_bitrate in fmt.SUPPORTED_MP3_BITRATES
                    else "192"
                )

                processor["preferredquality"] = bitrate
                quality = f"mp3 {bitrate}kbps"
            else:
                quality = f"{audio_convert} ({quality})"

            options["postprocessors"] = [processor]
            expected_ext = audio_convert

    info = _run(options, url)

    path = find_downloaded_file(directory, prefer_ext=expected_ext)

    if not path:
        raise RuntimeError("Download finished but no output file was found.")

    return _result(path, info, quality)


def download_subtitles(
    url,
    directory,
    language,
    auto=False,
    subtitle_format="srt"
):
    if not language or not re.fullmatch(r"[A-Za-z0-9_\-\.]{1,40}", language):
        raise fmt.FormatError("Invalid subtitle language.")

    if subtitle_format not in fmt.SUPPORTED_SUBTITLE_FORMATS:
        raise fmt.FormatError("Unsupported subtitle format.")

    target = "srt" if subtitle_format == "txt" else subtitle_format

    options = _base_download_options(directory)

    options.update({
        "skip_download": True,
        "writesubtitles": not auto,
        "writeautomaticsub": bool(auto),
        "subtitleslangs": [language],
        "subtitlesformat": f"{target}/vtt/best",
        "postprocessors": [
            {"key": "FFmpegSubtitlesConvertor", "format": target}
        ],
    })

    info = _run(options, url)

    produced = [
        name for name in os.listdir(directory)
        if name.endswith((".srt", ".vtt"))
    ]

    if not produced:
        raise RuntimeError(
            "No subtitle file was produced for this language."
        )

    produced.sort(key=lambda name: (not name.endswith("." + target), name))

    path = os.path.join(directory, produced[0])

    if subtitle_format == "txt":
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            text = fmt.subtitles_to_text(handle.read())

        path = os.path.join(directory, "media.txt")

        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)

    return _result(path, info, language)


def export_text(url, directory, text_format="txt"):
    info = resolve_entry(extract_info(url))

    content, extension, mime = fmt.build_text_export(info, text_format)

    path = os.path.join(directory, f"media.{extension}")

    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)

    return _result(path, info, text_format, mime=mime)
  
