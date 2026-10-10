"""Application settings, loaded from environment variables (and `backend/.env`).

All filesystem paths are resolved relative to the `backend/` directory so the
process works regardless of the current working directory.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# backend/  (this file lives at backend/app/config.py)
BACKEND_DIR = Path(__file__).resolve().parent.parent

# Load backend/.env if present. Real values are git-ignored; see .env.example.
load_dotenv(BACKEND_DIR / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "1" if default else "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


# --- Database ---------------------------------------------------------------
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "visionmitra")

# --- Vision / YOLO obstacle detection --------------------------------------
# Disabled by default. Set ENABLE_VISION_AI=1 to run YOLO inference.
ENABLE_VISION_AI = _env_bool("ENABLE_VISION_AI", default=False)
YOLO_CONF_THRESHOLD = float(os.environ.get("YOLO_CONF_THRESHOLD", "0.35"))
_YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "yolov8n.pt")


def resolve_model_path() -> str:
    """Return an absolute path to the YOLO weights file.

    Relative values are resolved against the `backend/` directory.
    """
    path = Path(_YOLO_MODEL_PATH).expanduser()
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return str(path)
