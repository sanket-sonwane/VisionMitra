"""YOLO inference helpers: model loading, image decoding, detection parsing.

The model is loaded lazily and cached for the process lifetime. Vision is
disabled unless ``ENABLE_VISION_AI=1`` *and* the optional numeric/imaging
dependencies are importable, so the API degrades to fail-safe responses instead
of crashing.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from threading import Lock
from typing import Any

from .. import config
from .pipeline import BoundingBox, RawDetection

try:
    import numpy as np
except Exception:  # pragma: no cover - optional dependency
    np = None

try:
    import cv2

    CV2_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    cv2 = None
    CV2_AVAILABLE = False

logger = logging.getLogger(__name__)

# Only classes relevant to ground mobility are reported.
MOBILITY_RELEVANT_CLASSES = {
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
    "train",
    "traffic light",
    "stop sign",
    "bench",
    "dog",
    "cat",
    "chair",
    "potted plant",
}

VISION_AVAILABLE = config.ENABLE_VISION_AI and CV2_AVAILABLE and np is not None

_yolo_model: Any | None = None
_yolo_lock = Lock()


def vision_available() -> bool:
    return VISION_AVAILABLE


def get_yolo_model() -> Any | None:
    """Return the cached YOLO model, loading it on first use."""
    global _yolo_model

    if not VISION_AVAILABLE:
        return None

    if _yolo_model is not None:
        return _yolo_model

    with _yolo_lock:
        if _yolo_model is None:
            try:
                from ultralytics import YOLO as UltralyticsYOLO

                _yolo_model = UltralyticsYOLO(config.resolve_model_path())
            except Exception as exc:
                logger.warning("YOLO disabled: failed to load ultralytics model (%s)", exc)
                return None
    return _yolo_model


def decode_base64_image(image_base64: str):
    """Decode a base64 (optionally data-URI) image into a BGR ndarray."""
    image_str = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
    image_bytes = base64.b64decode(image_str)
    np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)


async def run_blocking(func, *args, **kwargs):
    """Run a blocking callable in the default executor without blocking the loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: func(*args, **kwargs))


def build_raw_detections(
    result_obj: Any, frame_width: int, frame_height: int
) -> list[RawDetection]:
    """Convert a YOLO result object into normalized ``RawDetection`` instances."""
    detections: list[RawDetection] = []
    class_names = result_obj.names

    if result_obj.boxes is None:
        return detections

    for box in result_obj.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        cls_id = int(box.cls[0].item())
        confidence = float(box.conf[0].item())
        class_name = class_names.get(cls_id, str(cls_id))

        if class_name not in MOBILITY_RELEVANT_CLASSES:
            continue

        detections.append(
            RawDetection(
                class_id=cls_id,
                class_name=class_name,
                confidence=confidence,
                bbox=BoundingBox(
                    x1=x1 / frame_width,
                    y1=y1 / frame_height,
                    x2=x2 / frame_width,
                    y2=y2 / frame_height,
                ),
                frame_width=frame_width,
                frame_height=frame_height,
            )
        )

    return detections
