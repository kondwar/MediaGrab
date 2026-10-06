#!/bin/sh
# Container entrypoint.
#   1. bgutil PO-token provider on 127.0.0.1:4416 (used by yt-dlp / YouTube)
#   2. Telegram bot (only when TELEGRAM_BOT_TOKEN is set)
#   3. MediaGrab API + web interface on port 8080

node /opt/bgutil/server/build/main.js --host 127.0.0.1 --port 4416 &

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    python -m backend.bot &
else
    echo "TELEGRAM_BOT_TOKEN is not set: the Telegram bot is not started."
fi

exec uvicorn backend.app:app --host 0.0.0.0 --port 8080
