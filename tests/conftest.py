"""Shared pytest configuration.

Adds the ``backend/`` directory to ``sys.path`` so tests can import the
application package (``app.*``) the same way the server does.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
