"""
Analytics storage.

SQLite is used for the MVP (standard library, no extra service). The
schema uses plain SQL and epoch-second integers, so moving to PostgreSQL
later only means replacing connect() and the "?" placeholders.

Only what is needed is stored: Telegram user id, timestamp, platform,
domain (not the full URL), media type, format, quality, outcome, timing
and file size. No files are stored.

Analytics must never break a download: callers wrap these functions and
log failures.
"""

import logging
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path
from urllib.parse import urlparse

from . import config

log = logging.getLogger("mediagrab.db")

_init_lock = threading.Lock()
_initialized_for = None


class DatabaseConfigError(RuntimeError):
    pass


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    telegram_user_id INTEGER PRIMARY KEY,
    first_seen       INTEGER NOT NULL,
    last_seen        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ts               INTEGER NOT NULL,
    telegram_user_id INTEGER,
    action           TEXT NOT NULL,
    platform         TEXT,
    domain           TEXT,
    media_type       TEXT,
    format_id        TEXT,
    quality          TEXT,
    success          INTEGER NOT NULL,
    error_type       TEXT,
    processing_time  REAL,
    file_size        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_action ON events (action, success);
"""


def database_path(database_url=None):
    url = database_url or config.settings().database_url

    if not url.startswith("sqlite:///"):
        raise DatabaseConfigError(
            "Only sqlite:/// URLs are implemented. PostgreSQL support "
            "needs a new connect() implementation (see README)."
        )

    raw = url[len("sqlite:///"):]

    if not raw:
        raise DatabaseConfigError("DATABASE_URL has no file path.")

    # sqlite:////abs/path -> /abs/path ; sqlite:///rel/path -> BASE_DIR/rel/path
    path = Path(raw)

    if not path.is_absolute():
        path = config.BASE_DIR / path

    return path


def connect():
    path = database_path()

    path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row

    return connection


def init_db():
    global _initialized_for

    key = str(database_path())

    with _init_lock:
        if _initialized_for == key:
            return

        with closing(connect()) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(SCHEMA)
            connection.commit()

        _initialized_for = key


def domain_of(url):
    try:
        host = urlparse(str(url)).hostname or ""
    except ValueError:
        return None

    host = host.lower()

    if host.startswith("www."):
        host = host[4:]

    return host or None


def record_event(
    action,
    success,
    telegram_user_id=None,
    platform=None,
    url=None,
    media_type=None,
    format_id=None,
    quality=None,
    error_type=None,
    processing_time=None,
    file_size=None,
):
    init_db()

    now = int(time.time())

    with closing(connect()) as connection:
        if telegram_user_id is not None:
            connection.execute(
                """
                INSERT INTO users (telegram_user_id, first_seen, last_seen)
                VALUES (?, ?, ?)
                ON CONFLICT(telegram_user_id)
                DO UPDATE SET last_seen = excluded.last_seen
                """,
                (telegram_user_id, now, now)
            )

        connection.execute(
            """
            INSERT INTO events (
                ts, telegram_user_id, action, platform, domain,
                media_type, format_id, quality, success, error_type,
                processing_time, file_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now, telegram_user_id, action, platform, domain_of(url),
                media_type, format_id, quality, 1 if success else 0,
                error_type, processing_time, file_size
            )
        )

        connection.commit()


def safe_record_event(**kwargs):
    """record_event that never raises (analytics must not break users)."""

    try:
        record_event(**kwargs)
    except Exception:
        log.exception("Analytics write failed")


def _rows(connection, sql, params=()):
    return [dict(row) for row in connection.execute(sql, params).fetchall()]


def get_stats(days=7):
    """Numbers for the admin dashboard."""

    init_db()

    since = int(time.time()) - max(1, int(days)) * 86400

    with closing(connect()) as connection:
        one = lambda sql, params=(): connection.execute(sql, params).fetchone()[0]

        downloads_ok = one(
            "SELECT COUNT(*) FROM events WHERE action='download' AND success=1"
        )
        downloads_failed = one(
            "SELECT COUNT(*) FROM events WHERE action='download' AND success=0"
        )

        return {
            "window_days": int(days),
            "total_users": one("SELECT COUNT(*) FROM users"),
            "new_users": one(
                "SELECT COUNT(*) FROM users WHERE first_seen >= ?", (since,)
            ),
            "total_requests": one("SELECT COUNT(*) FROM events"),
            "info_requests": one(
                "SELECT COUNT(*) FROM events WHERE action='info'"
            ),
            "download_requests": downloads_ok + downloads_failed,
            "successful_downloads": downloads_ok,
            "failed_downloads": downloads_failed,
            "platforms": _rows(
                connection,
                """
                SELECT COALESCE(platform, 'unknown') AS name,
                       COUNT(*) AS count
                FROM events GROUP BY name ORDER BY count DESC LIMIT 20
                """
            ),
            "media_types": _rows(
                connection,
                """
                SELECT COALESCE(media_type, 'unknown') AS name,
                       COUNT(*) AS count
                FROM events WHERE action='download'
                GROUP BY name ORDER BY count DESC
                """
            ),
            "popular_qualities": _rows(
                connection,
                """
                SELECT quality AS name, COUNT(*) AS count
                FROM events
                WHERE action='download' AND success=1 AND quality IS NOT NULL
                GROUP BY quality ORDER BY count DESC LIMIT 10
                """
            ),
            "average_processing_time": one(
                """
                SELECT AVG(processing_time) FROM events
                WHERE action='download' AND success=1
                """
            ),
            "total_bandwidth_bytes": one(
                """
                SELECT COALESCE(SUM(file_size), 0) FROM events
                WHERE action='download' AND success=1
                """
            ),
        }
      
