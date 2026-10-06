"""
MediaGrab Telegram bot.

Handles /start (and /help) and replies with a button that opens the
Telegram Mini App. Uses the Bot API over HTTPS with long polling, with
the standard library only (no extra dependency).

The bot token is read from the TELEGRAM_BOT_TOKEN environment variable
and is never printed or stored.

Run:  python -m backend.bot
"""

import json
import logging
import sys
import time
import urllib.error
import urllib.request

from . import config

log = logging.getLogger("mediagrab.bot")

API_URL = "https://api.telegram.org/bot{token}/{method}"

TEXTS = {
    "en": {
        "welcome": (
            "Welcome to MediaGrab 👋\n\n"
            "Open the app, paste a link, choose a real quality or format, "
            "and download directly."
        ),
        "button": "🚀 Open MediaGrab",
        "group": "Open MediaGrab here: {url}",
    },
    "ar": {
        "welcome": (
            "أهلاً بك في MediaGrab 👋\n\n"
            "افتح التطبيق، الصق الرابط، اختر الجودة أو الصيغة المتاحة فعلياً، "
            "ثم حمّل مباشرة."
        ),
        "button": "🚀 افتح MediaGrab",
        "group": "افتح MediaGrab من هنا: {url}",
    },
}


class TelegramAPIError(RuntimeError):
    pass


def _language(language_code):
    return "ar" if (language_code or "").lower().startswith("ar") else "en"


def _scrub(text, token):
    return str(text).replace(token, "<token>") if token else str(text)


def api_call(token, method, payload=None, timeout=60):
    request = urllib.request.Request(
        API_URL.format(token=token, method=method),
        data=json.dumps(payload or {}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))

    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            raise TelegramAPIError(f"{method}: HTTP {e.code}")

    except Exception as e:
        raise TelegramAPIError(f"{method}: {_scrub(e, token)}")

    if not body.get("ok"):
        raise TelegramAPIError(
            f"{method}: {body.get('description', 'unknown error')}"
        )

    return body.get("result")


def build_start_reply(webapp_url, language_code=None, private=True):
    """Returns (text, reply_markup or None). Pure function."""

    texts = TEXTS[_language(language_code)]

    if not private:
        # Web App buttons are for private chats; groups get a plain link.
        return texts["group"].format(url=webapp_url), None

    return texts["welcome"], {
        "inline_keyboard": [[
            {
                "text": texts["button"],
                "web_app": {"url": webapp_url}
            }
        ]]
    }


def handle_update(update, token, webapp_url, call=api_call):
    message = update.get("message")

    if not message:
        return False

    text = (message.get("text") or "").strip()

    if not text.startswith("/"):
        command = "other"
    else:
        command = text.split()[0].split("@")[0].lower()

    chat = message.get("chat") or {}
    chat_id = chat.get("id")

    if chat_id is None:
        return False

    language = (message.get("from") or {}).get("language_code")

    reply, markup = build_start_reply(
        webapp_url,
        language,
        private=chat.get("type") == "private"
    )

    if command not in ("/start", "/help", "other"):
        return False

    payload = {"chat_id": chat_id, "text": reply}

    if markup:
        payload["reply_markup"] = markup

    call(token, "sendMessage", payload)

    return True


def setup(token, webapp_url, call=api_call):
    """Best-effort startup configuration. Failures are only logged."""

    # getUpdates does not work while a webhook is set.
    try:
        call(token, "deleteWebhook", {"drop_pending_updates": False})
    except TelegramAPIError as e:
        log.warning("deleteWebhook failed: %s", e)

    texts = TEXTS["en"]

    try:
        call(token, "setChatMenuButton", {
            "menu_button": {
                "type": "web_app",
                "text": "MediaGrab",
                "web_app": {"url": webapp_url}
            }
        })
    except TelegramAPIError as e:
        log.warning("setChatMenuButton failed: %s", e)

    return texts


def run():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )

    current = config.settings()

    token = current.telegram_bot_token

    if not token:
        log.error(
            "TELEGRAM_BOT_TOKEN is not set: the bot is not started. "
            "The web app keeps working."
        )
        return 1

    setup(token, current.webapp_url)

    log.info("Bot started (long polling).")

    offset = None
    delay = 1

    while True:
        try:
            payload = {"timeout": 30, "allowed_updates": ["message"]}

            if offset is not None:
                payload["offset"] = offset

            updates = api_call(token, "getUpdates", payload, timeout=45)

            delay = 1

            for update in updates or []:
                offset = update["update_id"] + 1

                try:
                    handle_update(update, token, current.webapp_url)
                except Exception as e:
                    log.error("update failed: %s", _scrub(e, token))

        except Exception as e:
            log.error("polling error: %s", _scrub(e, token))

            time.sleep(delay)

            delay = min(delay * 2, 30)


if __name__ == "__main__":
    sys.exit(run())
  
