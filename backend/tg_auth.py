"""
Telegram Mini App `initData` validation (standard library only).

The browser only *sends* initData; the signature is checked here with the
bot token, so the Telegram user id can be trusted. Algorithm as described
in Telegram's Mini Apps documentation ("Validating data received via the
Mini App"):

  data_check_string = all fields except `hash`, sorted by key,
                      formatted "key=value", joined with "\n"
  secret_key        = HMAC_SHA256(key="WebAppData", message=bot_token)
  hash              = hex(HMAC_SHA256(key=secret_key,
                                      message=data_check_string))
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


class InitDataError(ValueError):
    """initData is missing, malformed, forged or expired."""


def validate_init_data(init_data, bot_token, max_age=86400, now=None):
    """
    Returns the verified Telegram user dict (contains "id").
    Raises InitDataError when the data cannot be trusted.
    """

    if not bot_token:
        raise InitDataError("Bot token is not configured.")

    if not init_data or not isinstance(init_data, str):
        raise InitDataError("initData is empty.")

    try:
        pairs = parse_qsl(
            init_data,
            keep_blank_values=True,
            strict_parsing=True
        )
    except ValueError:
        raise InitDataError("initData is malformed.")

    fields = dict(pairs)

    received_hash = fields.pop("hash", None)

    if not received_hash:
        raise InitDataError("initData has no hash.")

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(fields.items())
    )

    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode("utf-8"),
        hashlib.sha256
    ).digest()

    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise InitDataError("initData signature is invalid.")

    try:
        auth_date = int(fields.get("auth_date", ""))
    except ValueError:
        raise InitDataError("initData has no valid auth_date.")

    current = time.time() if now is None else now

    if max_age and current - auth_date > max_age:
        raise InitDataError("initData has expired.")

    try:
        user = json.loads(fields.get("user", ""))
    except (ValueError, TypeError):
        raise InitDataError("initData has no user.")

    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        raise InitDataError("initData user is invalid.")

    return user


def verified_user_id(init_data, bot_token, max_age=86400):
    """Telegram user id, or None when there is nothing trustworthy."""

    try:
        return validate_init_data(init_data, bot_token, max_age)["id"]
    except InitDataError:
        return None
      
