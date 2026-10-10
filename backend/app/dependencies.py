"""Per-session registry of robust detection pipelines.

The temporal pipeline keeps state (tracks, risk level, alert dedup) across
frames, so a client must be routed to the *same* pipeline for the duration of a
session. Pipelines are created lazily and bounded to avoid unbounded memory
growth from abandoned sessions.
"""

from __future__ import annotations

import logging
from threading import Lock

from .vision.pipeline import RobustDetectionPipeline

logger = logging.getLogger(__name__)

# Soft cap on retained pipelines. When exceeded, the oldest session is evicted.
MAX_SESSION_PIPELINES = 200

_pipelines: dict[str, RobustDetectionPipeline] = {}
_lock = Lock()


def get_pipeline(session_id: str) -> RobustDetectionPipeline:
    """Return the pipeline for ``session_id``, creating it on first use."""
    with _lock:
        pipeline = _pipelines.get(session_id)
        if pipeline is None:
            if len(_pipelines) >= MAX_SESSION_PIPELINES:
                oldest_id = next(iter(_pipelines))
                _pipelines.pop(oldest_id, None)
                logger.info("Evicted oldest detection session %s", oldest_id)
            pipeline = RobustDetectionPipeline()
            _pipelines[session_id] = pipeline
            logger.info("Created detection pipeline for session %s", session_id)
        return pipeline


def clear_pipeline(session_id: str) -> bool:
    """Drop pipeline state for a finished session. Returns True if removed."""
    with _lock:
        removed = _pipelines.pop(session_id, None) is not None
    if removed:
        logger.info("Cleared detection pipeline for session %s", session_id)
    return removed


def reset() -> None:
    """Drop all pipelines (used on shutdown / tests)."""
    with _lock:
        _pipelines.clear()
