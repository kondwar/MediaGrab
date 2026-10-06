"""
Pure format logic for MediaGrab (standard library only).

Everything here works on the dictionaries yt-dlp returns, so it can be
unit-tested without yt-dlp, FFmpeg or a network connection.

No quality list is hard-coded: every entry comes from the real formats
that yt-dlp reported for the URL.
"""

import html
import json
import re

# Characters yt-dlp interprets as format-selector syntax. A real format_id
# returned by /api/info never needs them.
FORMAT_ID_FORBIDDEN = re.compile(r"[\s/+,\[\]()*|]")

# Codec families that can be stream-copied into each container.
MP4_VIDEO = ("avc1", "avc3", "h264", "hvc1", "hev1", "hevc", "h265", "av01")
MP4_AUDIO = ("mp4a", "aac")
WEBM_VIDEO = ("vp9", "vp09", "vp8", "av01")
WEBM_AUDIO = ("opus", "vorbis")

SUPPORTED_AUDIO_CONVERSIONS = ("mp3", "m4a", "opus")
SUPPORTED_MP3_BITRATES = ("128", "192", "256", "320")
SUPPORTED_SUBTITLE_FORMATS = ("srt", "vtt", "txt")
SUPPORTED_TEXT_FORMATS = ("txt", "json", "html")


class FormatError(ValueError):
    """The requested format cannot be used for this media."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

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


def valid_format_id(format_id):
    return bool(
        format_id
        and len(format_id) <= 200
        and not FORMAT_ID_FORBIDDEN.search(format_id)
    )


def _starts(value, prefixes):
    text = (value or "").lower()
    return any(text.startswith(prefix) for prefix in prefixes)


def is_video_stream(f):
    """
    A stream is video when vcodec is not "none" and either a codec or a
    height is known (some platforms report neither codec but do report a
    height).
    """

    vcodec = f.get("vcodec")

    return vcodec != "none" and bool(vcodec or f.get("height"))


def is_audio_stream(f):
    return f.get("acodec") not in (None, "none")


def is_audio_only(f):
    return f.get("vcodec") == "none" and is_audio_stream(f)


def is_video_only(f):
    """Video stream whose audio is explicitly reported as missing."""

    return is_video_stream(f) and f.get("acodec") == "none"


def usable_formats(info):
    """Formats that can actually be downloaded (no storyboards)."""

    result = []

    for f in (info or {}).get("formats") or []:
        if not f.get("format_id"):
            continue

        if f.get("protocol") == "mhtml":
            continue

        result.append(f)

    return result


def height_label(f):
    height = f.get("height")

    if not height:
        return "unknown"

    return f"{height}p"


# ---------------------------------------------------------------------------
# Audio selection (dynamic, never a fixed format id)
# ---------------------------------------------------------------------------

def _audio_container_match(video_f, audio_f):
    """1 when the audio stream can be copied into the video's container."""

    video_ext = (video_f.get("ext") or "").lower()
    audio_ext = (audio_f.get("ext") or "").lower()
    audio_codec = audio_f.get("acodec")

    if video_ext in ("mp4", "m4v", "mov"):
        if audio_ext in ("m4a", "mp4") or _starts(audio_codec, MP4_AUDIO):
            return 1

        return 0

    if video_ext == "webm":
        if audio_ext == "webm" or _starts(audio_codec, WEBM_AUDIO):
            return 1

        return 0

    return 0


def pick_audio(formats, video_f, prefer_language=None):
    """
    Best audio-only format to pair with a video-only format.

    Order of preference:
      1. the requested language (if any)
      2. container-compatible audio (so the merge can stay a stream copy)
      3. yt-dlp's own language_preference (original language first)
      4. highest bitrate
    """

    candidates = [
        f for f in formats
        if f.get("format_id") and is_audio_only(f)
        and f.get("protocol") != "mhtml"
    ]

    if not candidates:
        return None

    def language_match(f):
        if not prefer_language:
            return 0

        language = (f.get("language") or "").lower()
        wanted = prefer_language.lower()

        return 1 if language == wanted or language.startswith(wanted + "-") else 0

    def key(f):
        return (
            language_match(f),
            _audio_container_match(video_f, f),
            f.get("language_preference") or 0,
            f.get("abr") or 0,
            f.get("tbr") or 0,
        )

    return max(candidates, key=key)


def choose_container(video_f, audio_f):
    """
    Pick the output container for a video+audio merge so that FFmpeg can
    copy both streams (no re-encoding).

      MP4  when both codecs are MP4-compatible
      WEBM when both codecs are WebM-compatible
      MKV  otherwise (accepts nearly everything, so the merge never fails
           just because of the container)
    """

    vcodec = video_f.get("vcodec")
    acodec = audio_f.get("acodec") if audio_f else None

    if _starts(vcodec, MP4_VIDEO) and _starts(acodec, MP4_AUDIO):
        return "mp4"

    if _starts(vcodec, WEBM_VIDEO) and _starts(acodec, WEBM_AUDIO):
        return "webm"

    return "mkv"


def quality_label(f):
    if is_video_stream(f):
        label = height_label(f)
        fps = f.get("fps")

        if fps and fps > 30:
            label += f"{round(fps)}"

        return label

    bitrate = f.get("abr") or f.get("tbr")

    return f"{round(bitrate)}kbps" if bitrate else "original"


# ---------------------------------------------------------------------------
# Download plan
# ---------------------------------------------------------------------------

def plan_download(formats, format_id, prefer_language=None):
    """
    Decide how a chosen format has to be downloaded.

    Returns a dict:
      mode      "direct" | "merge" | "audio" | "video_only"
      selector  value for yt-dlp's `format` option
      container merge container (only for "merge")
      quality   label for analytics
      video_id / audio_id  ids actually used
    """

    if not valid_format_id(format_id):
        raise FormatError(
            "Invalid format_id. Use a format_id returned by /api/info."
        )

    chosen = next(
        (f for f in formats if f.get("format_id") == format_id),
        None
    )

    if chosen is None:
        raise FormatError(
            "This format is no longer available for this media. "
            "Run detection again."
        )

    # Real audio-only format: download it as it is.
    if is_audio_only(chosen):
        return {
            "mode": "audio",
            "selector": format_id,
            "container": None,
            "quality": quality_label(chosen),
            "video_id": None,
            "audio_id": format_id,
            "source": chosen,
        }

    # Video-only: find the best matching audio dynamically and merge.
    if is_video_only(chosen):
        audio = pick_audio(formats, chosen, prefer_language)

        if audio is None:
            return {
                "mode": "video_only",
                "selector": format_id,
                "container": None,
                "quality": quality_label(chosen),
                "video_id": format_id,
                "audio_id": None,
                "source": chosen,
            }

        return {
            "mode": "merge",
            "selector": f"{format_id}+{audio['format_id']}",
            "container": choose_container(chosen, audio),
            "quality": quality_label(chosen),
            "video_id": format_id,
            "audio_id": audio["format_id"],
            "source": chosen,
        }

    # Video + audio in one format (or audio codec unknown): direct.
    return {
        "mode": "direct",
        "selector": format_id,
        "container": None,
        "quality": quality_label(chosen),
        "video_id": format_id,
        "audio_id": None,
        "source": chosen,
    }


# ---------------------------------------------------------------------------
# /api/info format list
# ---------------------------------------------------------------------------

def clean_formats(info):
    """
    Build {"video": [...], "audio": [...]} from the real yt-dlp formats.
    Field names of the previous version are kept; new fields are added.
    """

    if not info:
        return {"video": [], "audio": []}

    raw = usable_formats(info)

    video = []
    audio = []

    seen_video = set()
    seen_audio = set()

    for f in raw:
        format_id = f["format_id"]
        ext = f.get("ext")
        height = f.get("height")
        width = f.get("width")
        vcodec = f.get("vcodec")
        acodec = f.get("acodec")
        tbr = f.get("tbr")

        filesize = f.get("filesize") or f.get("filesize_approx")

        resolution = f.get("resolution")

        if not resolution and width and height:
            resolution = f"{width}x{height}"

        if is_video_stream(f):
            key = (height_label(f), ext, format_id)

            if key in seen_video:
                continue

            seen_video.add(key)

            entry = {
                "format_id": format_id,
                "quality": height_label(f),
                "format": ext,
                "ext": ext,
                "resolution": resolution,
                "width": width,
                "height": height,
                "fps": f.get("fps"),
                "filesize": filesize,
                "filesize_text": format_size(filesize),
                "vcodec": vcodec,
                "acodec": acodec,
                "has_audio": is_audio_stream(f),
                "kind": "video_only" if is_video_only(f) else "combined",
                "tbr": tbr,
                "abr": f.get("abr"),
                "format_note": f.get("format_note"),
                "protocol": f.get("protocol"),
            }

            if is_video_only(f):
                paired = pick_audio(raw, f)

                entry["merge_audio_format_id"] = (
                    paired["format_id"] if paired else None
                )
                entry["merge_container"] = (
                    choose_container(f, paired) if paired else ext
                )

            video.append(entry)

        elif is_audio_stream(f):
            bitrate = f.get("abr") or tbr
            key = (quality_label(f), ext, format_id)

            if key in seen_audio:
                continue

            seen_audio.add(key)

            audio.append({
                "format_id": format_id,
                "quality": quality_label(f),
                "format": ext,
                "ext": ext,
                "bitrate": bitrate,
                "abr": f.get("abr"),
                "tbr": tbr,
                "filesize": filesize,
                "filesize_text": format_size(filesize),
                "acodec": acodec,
                "vcodec": vcodec,
                "language": f.get("language"),
                "format_note": f.get("format_note"),
                "protocol": f.get("protocol"),
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

    return {"video": video, "audio": audio}


def audio_languages(info):
    """Distinct languages reported on audio-only formats."""

    languages = []

    for f in usable_formats(info):
        if not is_audio_only(f):
            continue

        language = f.get("language")

        if language and language not in languages:
            languages.append(language)

    return languages


# ---------------------------------------------------------------------------
# Subtitles
# ---------------------------------------------------------------------------

def subtitle_tracks(info):
    """
    Real subtitle / automatic caption tracks from yt-dlp. Nothing is
    added that the source does not report.
    """

    tracks = []

    for auto, key in ((False, "subtitles"), (True, "automatic_captions")):
        for language, items in ((info or {}).get(key) or {}).items():

            # YouTube lists replay chat as a "subtitle"; it is not one.
            if language == "live_chat":
                continue

            items = items or []

            extensions = sorted({
                item.get("ext") for item in items if item.get("ext")
            })

            name = next(
                (item.get("name") for item in items if item.get("name")),
                None
            )

            tracks.append({
                "lang": language,
                "name": name,
                "auto": auto,
                "exts": extensions,
            })

    return tracks


_TAG = re.compile(r"<[^>]+>")
_TIMING = re.compile(r"-->")


def subtitles_to_text(content):
    """Strip SRT/VTT markup and return the plain spoken text."""

    lines = []

    block_is_note = False

    for raw_line in str(content).splitlines():
        line = raw_line.strip().lstrip("\ufeff")

        if not line:
            block_is_note = False
            continue

        if block_is_note:
            continue

        upper = line.upper()

        if upper.startswith("WEBVTT"):
            continue

        if upper.startswith(("NOTE", "STYLE", "REGION")):
            block_is_note = True
            continue

        if _TIMING.search(line):
            continue

        if line.isdigit():
            continue

        text = html.unescape(_TAG.sub("", line)).strip()

        if text and (not lines or lines[-1] != text):
            lines.append(text)

    return "\n".join(lines) + ("\n" if lines else "")


# ---------------------------------------------------------------------------
# Text export (description + metadata that yt-dlp reports)
# ---------------------------------------------------------------------------

def build_text_export(info, fmt):
    """
    Returns (content, extension, mime_type) for the "Text" media type:
    title, uploader and description exactly as the source reports them.
    """

    if fmt not in SUPPORTED_TEXT_FORMATS:
        raise FormatError("Unsupported text format.")

    data = {
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "platform": info.get("extractor_key"),
        "webpage_url": info.get("webpage_url"),
        "duration": info.get("duration"),
        "view_count": info.get("view_count"),
        "upload_date": info.get("upload_date"),
        "description": info.get("description"),
    }

    if fmt == "json":
        return (
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            "json",
            "application/json"
        )

    if fmt == "html":
        rows = "".join(
            f"<tr><th>{html.escape(key)}</th>"
            f"<td>{html.escape(str(value))}</td></tr>"
            for key, value in data.items()
            if value not in (None, "")
        )

        page = (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
            f"<title>{html.escape(str(data['title'] or 'MediaGrab'))}"
            "</title></head><body><table>"
            f"{rows}</table></body></html>\n"
        )

        return page, "html", "text/html"

    text = "\n".join(
        f"{key}: {value}"
        for key, value in data.items()
        if value not in (None, "")
    )

    return text + "\n", "txt", "text/plain"
  
