"""Deprecated entrypoint kept for backwards compatibility.

Prefer the canonical command, run from the ``backend/`` directory::

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

try:  # running from the backend/ directory
    from app.main import app
except ModuleNotFoundError:  # running from the repository root
    from backend.app.main import app

__all__ = ["app"]
