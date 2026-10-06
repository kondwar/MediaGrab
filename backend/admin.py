"""
Admin dashboard (HTTP Basic auth).

The password comes only from the ADMIN_PASSWORD environment variable. If
it is not set the dashboard is disabled (503) instead of being open.
Use it over HTTPS only (Basic auth sends the password with every request).
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from . import config, db

router = APIRouter()

_basic = HTTPBasic(auto_error=False)


def require_admin(credentials: HTTPBasicCredentials = Depends(_basic)):
    current = config.settings()

    if not current.admin_password:
        raise HTTPException(
            status_code=503,
            detail="Admin is disabled. Set the ADMIN_PASSWORD variable."
        )

    ok = bool(credentials) and (
        secrets.compare_digest(
            credentials.username.encode("utf-8"),
            current.admin_username.encode("utf-8")
        )
        and secrets.compare_digest(
            credentials.password.encode("utf-8"),
            current.admin_password.encode("utf-8")
        )
    )

    if not ok:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": 'Basic realm="MediaGrab admin"'}
        )

    return True


@router.get("/admin", response_class=HTMLResponse)
def admin_page(_: bool = Depends(require_admin)):
    page = config.settings().templates_dir / "admin.html"

    return HTMLResponse(
        page.read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-store"}
    )


@router.get("/api/admin/stats")
def admin_stats(days: int = 7, _: bool = Depends(require_admin)):
    days = min(max(days, 1), 365)

    return db.get_stats(days)
  
