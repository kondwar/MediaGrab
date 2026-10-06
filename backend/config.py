"""
MediaGrab configuration.

Every value comes from an environment variable. Nothing secret is stored
in the code or in the repository. Values are read when settings() is
called, so tests can change os.environ safely.
"""

import os
from dataclasses import dataclass
from pathlib import Path

VERSION = "2.0.0"

BASE_DIR = Path(__file__).resolve().parent.parent

DEFAULT_WEBAPP_URL = "https://mediagrab.syria.blitz.cloud/"

# Adsgram SDK location. Not verified against Adsgram's documentation
# (no account yet): confirm it there and override with ADSGRAM_SDK_URL.
DEFAULT_ADSGRAM_SDK_URL = "https://sad.adsgram.ai/js/sad.min.js"


def _bool(name, default=False):
    raw = os.getenv(name)

    if raw is None or raw.strip() == "":
        return default

    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int(name, default):
    raw = os.getenv(name)

    if raw is None or raw.strip() == "":
        return default

    try:
        return int(raw.strip())
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # Paths
    web_dir: Path
    translations_dir: Path
    templates_dir: Path

    # Telegram
    telegram_bot_token: str
    webapp_url: str
    initdata_max_age: int

    # Adsgram (optional)
    adsgram_enabled: bool
    adsgram_block_id: str
    adsgram_fail_mode: str  # "allow" or "block"
    adsgram_sdk_url: str

    # Database
    database_url: str

    # Admin
    admin_username: str
    admin_password: str

    # Download limits
    max_concurrent_downloads: int
    max_filesize_mb: int  # 0 = no limit


def settings():
    fail_mode = os.getenv("ADSGRAM_FAIL_MODE", "allow").strip().lower()

    if fail_mode not in ("allow", "block"):
        fail_mode = "allow"

    return Settings(
        web_dir=Path(os.getenv("MEDIAGRAB_WEB_DIR") or BASE_DIR / "web"),
        translations_dir=Path(
            os.getenv("MEDIAGRAB_TRANSLATIONS_DIR")
            or BASE_DIR / "translations"
        ),
        templates_dir=Path(__file__).resolve().parent / "templates",

        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        webapp_url=(
            os.getenv("WEBAPP_URL", "").strip() or DEFAULT_WEBAPP_URL
        ),
        initdata_max_age=_int("TELEGRAM_INITDATA_MAX_AGE", 86400),

        adsgram_enabled=_bool("ADSGRAM_ENABLED", False),
        adsgram_block_id=os.getenv("ADSGRAM_BLOCK_ID", "").strip(),
        adsgram_fail_mode=fail_mode,
        adsgram_sdk_url=(
            os.getenv("ADSGRAM_SDK_URL", "").strip()
            or DEFAULT_ADSGRAM_SDK_URL
        ),

        database_url=(
            os.getenv("DATABASE_URL", "").strip()
            or "sqlite:///data/mediagrab.db"
        ),

        admin_username=os.getenv("ADMIN_USERNAME", "admin").strip() or "admin",
        admin_password=os.getenv("ADMIN_PASSWORD", ""),

        max_concurrent_downloads=max(
            1, _int("MAX_CONCURRENT_DOWNLOADS", 2)
        ),
        max_filesize_mb=max(0, _int("MAX_FILESIZE_MB", 0)),
  )
  
