# MediaGrab

Telegram Bot + Telegram Mini App + web downloader, powered by
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and FFmpeg, with built-in
analytics, a protected admin dashboard and optional Adsgram.

> Supported by yt-dlp, subject to the current extractor and site
> availability. Sites change; a platform that works today may break
> tomorrow until yt-dlp is updated.

## How it works

```
Telegram user -> /start -> "Open MediaGrab" button -> Mini App (web UI)
  -> paste URL -> POST /api/info (real formats from yt-dlp)
  -> choose media type + real quality/format
  -> [Adsgram, only if enabled]
  -> POST /api/download
       combined video+audio -> downloaded as is
       video-only          -> best audio picked dynamically, merged by
                              yt-dlp via FFmpeg (stream copy)
       audio-only          -> downloaded, or converted (MP3/M4A/Opus)
  -> file is sent directly -> temp folder deleted -> analytics saved
```

Container rule for merges (no re-encoding): MP4 when codecs are
MP4-compatible (H.264/HEVC/AV1 + AAC), WebM for VP9/AV1 + Opus/Vorbis,
otherwise MKV so the merge does not fail.

## Layout

| Path | Purpose |
|---|---|
| `backend/app.py` | FastAPI app and endpoints |
| `backend/formats.py` | Format logic, audio pairing, container choice (pure) |
| `backend/downloader.py` | yt-dlp calls, merge, subtitles, cleanup |
| `backend/tg_auth.py` | Telegram `initData` signature check |
| `backend/db.py` | SQLite analytics |
| `backend/admin.py`, `templates/admin.html` | Admin dashboard |
| `backend/bot.py` | Telegram bot (`/start` -> Mini App button) |
| `web/` | Interface (`index.html`, `app.js`, `formats-ui.js`, `style.css`) |
| `translations/` | `en.json` (default), `ar.json` (RTL) |
| `start.sh`, `Dockerfile` | Container start (bgutil, bot, API) |

## Download modes (free vs paid)

One codebase, two behaviours selected by `DOWNLOAD_MODE`:

- **`direct` (default, free):** the user's own device downloads from the
  source. The server only runs yt-dlp to read information and hands out
  the real direct link. Only formats that are a single plain http(s) file
  with video and audio together (or audio only) are offered; split
  video/audio, HLS/DASH streams, MP3 conversion and merged files are not
  available. No media passes through the server. `/api/download` answers
  403. Limits: links may be refused for the user's device (IP-bound or
  header-bound links, some platforms), YouTube mostly splits its higher
  qualities, and a link may open in the player instead of saving.
- **`server` (paid):** the server downloads, merges with FFmpeg,
  converts and sends the file (everything described above). Uses server
  CPU, disk and bandwidth, so set `MAX_CONCURRENT_DOWNLOADS` and
  `MAX_FILESIZE_MB`.

Deploy the paid bot as a second app with `DOWNLOAD_MODE=server` and its
own `TELEGRAM_BOT_TOKEN`.

## Endpoints

- `GET /` web interface (JSON status if `Accept: application/json`)
- `GET /health`
- `GET /api/config` public settings (Adsgram on/off, no secrets)
- `POST /api/info` `{url}` -> real metadata and formats
- `POST /api/track` records a direct download started on the user's device
- `POST /api/download` `{url, format_id, media_type, ...}` -> file (server mode only)
  (`media_type`: `video` | `audio` | `subtitles` | `text`)
- `GET /api/debug/youtube` (admin login required)
- `GET /admin`, `GET /api/admin/stats` (admin login required)

## Environment variables

See `.env.example`. **Never commit real values.**

| Name | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. Also used to verify `initData`. Without it the bot does not start and Telegram identity is not verified |
| `WEBAPP_URL` | HTTPS URL the bot button opens (default `https://mediagrab.syria.blitz.cloud/`) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin login. Dashboard is disabled while the password is empty |
| `DOWNLOAD_MODE` | `direct` (default, free version) or `server` (paid version), see below |
| `ADSGRAM_ENABLED` | `false` by default |
| `ADSGRAM_BLOCK_ID` | Your Adsgram block id (public in the page by design) |
| `ADSGRAM_FAIL_MODE` | `allow` (default): continue if the ad fails. `block`: stop |
| `ADSGRAM_SDK_URL` | Override the Adsgram script URL (see below) |
| `DATABASE_URL` | `sqlite:///data/mediagrab.db` by default |
| `MAX_CONCURRENT_DOWNLOADS` | Default 2; extra requests get HTTP 503 |
| `MAX_FILESIZE_MB` | 0 = unlimited |

## Run locally

```bash
pip install -r backend/requirements.txt
# FFmpeg and Node.js must be installed
uvicorn backend.app:app --port 8080
python -m backend.bot        # only with TELEGRAM_BOT_TOKEN set
```

Docker: `docker build -t mediagrab . && docker run -p 8080:8080 --env-file .env mediagrab`

## Telegram setup

1. Create/choose the bot in @BotFather and copy its token.
2. Put the token in `TELEGRAM_BOT_TOKEN` on your host (not in GitHub).
3. Deploy. The bot calls `deleteWebhook` and `setChatMenuButton` at
   start (best effort) and answers `/start` with the
   **🚀 Open MediaGrab** button.
4. Optional: in @BotFather, `/newapp` or the bot's Menu Button can also
   point at the same URL.
5. Run **one** bot process per token (long polling).

## Telegram identity

The page sends `Telegram.WebApp.initData` in the
`X-Telegram-Init-Data` header. The backend verifies its HMAC with the
bot token and expiry (`TELEGRAM_INITDATA_MAX_AGE`) before using the user
id. Invalid or missing data means the request is simply anonymous.

## Analytics and admin

Stored per request: Telegram user id (if verified), time, platform,
**domain only** (never the full URL), media type, format id, quality,
success/failure, processing time, file size. Open `/admin` (browser asks
for the admin login; use HTTPS).

**Persistence:** the SQLite file lives inside the container. Unless your
host mounts persistent storage at that path, history is lost on
redeploy. Check your host's documentation. PostgreSQL is not
implemented yet; the schema is plain SQL so only `connect()` and the
`?` placeholders in `backend/db.py` need porting.

## Adsgram (optional)

Off by default: users go straight to download. With
`ADSGRAM_ENABLED=true` and a block id, the page shows an ad before the
download. The gate runs in the browser, so it is a user flow, not
enforcement. The SDK URL and `show()` behaviour in
`web/app.js` were **not verified against Adsgram's documentation or an
account**; confirm them when you create your account.

## Tests

```bash
python -m unittest discover -s tests -t .       # no extra packages
pip install -r backend/requirements.txt -r requirements-dev.txt
python -m pytest tests                           # also runs HTTP tests
```

What is covered: format logic, audio pairing, container choice,
download wiring with a yt-dlp stand-in, temp cleanup, `initData`,
analytics, the bot reply, frontend helpers, and FFmpeg stream-copy
muxing and MP3 encoding. Real sites, real Telegram and Docker are not
covered by automated tests; test them on your deployment.

## Known limits

- Long downloads/merges are served in one request; your host's request
  timeout applies.
- In some Telegram clients saving a downloaded blob may behave
  differently; test on iOS and Android.
- YouTube may need extra setup (PO tokens via bgutil, cookies) on
  server IPs. Never commit cookies.
