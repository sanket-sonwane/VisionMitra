"""Obstacle detection endpoints backed by the robust temporal pipeline."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter

from .. import config, dependencies
from ..db import db
from ..geometry import classify_direction, classify_distance
from ..models import (
    AlertHistory,
    AlertHistoryCreate,
    ObstacleDetectionRequest,
    ObstacleDetectionResponse,
)
from ..vision import inference
from ..vision.pipeline import FailSafeManager, RiskLevel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["detection"])

_INFERENCE_TIMEOUT_SECONDS = 5.0


def _fallback(error_type: str, safe_direction: str) -> ObstacleDetectionResponse:
    message, risk = FailSafeManager.get_fallback_response(error_type)
    return ObstacleDetectionResponse(
        obstacles=[],
        safe_direction=safe_direction,
        warning_level=risk.value,
        audio_message=message,
    )


@router.post("/detect-obstacles", response_model=ObstacleDetectionResponse)
async def detect_obstacles(request: ObstacleDetectionRequest):
    """Detect obstacles in a single frame with temporal consistency.

    Frames from the same session are routed through a per-session pipeline that
    tracks objects across frames, smooths confidence, classifies motion, and
    only reports objects that persist.
    """
    if not inference.vision_available():
        return _fallback("model_unavailable", "forward")

    frame = inference.decode_base64_image(request.image_base64)
    if frame is None:
        return _fallback("image_invalid", "stop")

    model = inference.get_yolo_model()
    if model is None:
        return _fallback("model_unavailable", "forward")

    try:
        yolo_results = await asyncio.wait_for(
            inference.run_blocking(
                model.predict,
                frame,
                conf=config.YOLO_CONF_THRESHOLD,
                verbose=False,
            ),
            timeout=_INFERENCE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return _fallback("inference_timeout", "forward")
    except Exception as exc:
        logger.error("YOLO inference failed: %s", exc, exc_info=True)
        return _fallback("unknown_error", "stop")

    frame_height, frame_width = frame.shape[:2]
    raw_detections = inference.build_raw_detections(yolo_results[0], frame_width, frame_height)

    session_id = request.session_id or f"session_{request.user_id}"
    pipeline = dependencies.get_pipeline(session_id)
    detection_result = pipeline.process_frame(raw_detections)

    obstacles: list[dict] = []
    for obj in detection_result.tracked_objects:
        if not obj.is_persistent:
            continue  # only surface objects confirmed across frames

        bbox = obj.bbox_history[-1]
        obstacles.append(
            {
                "type": obj.class_name,
                "distance": classify_distance(bbox.area),
                "direction": classify_direction(bbox.center[0]),
                "confidence": round(obj.smoothed_confidence, 3),
                "moving": obj.motion_state.name.lower(),
                "persistence_frames": obj.visibility_streak,
                "object_id": obj.object_id,
            }
        )

    if detection_result.alert_triggered and detection_result.risk_level in (
        RiskLevel.DANGER,
        RiskLevel.CRITICAL,
    ):
        alert_log = AlertHistory(
            **AlertHistoryCreate(
                user_id=request.user_id,
                session_id=session_id,
                alert_type="obstacle",
                message=detection_result.audio_message,
                location=(
                    {"latitude": request.latitude, "longitude": request.longitude}
                    if request.latitude is not None
                    else None
                ),
                priority=detection_result.risk_level.value,
            ).model_dump()
        )
        await db.alert_history.insert_one(alert_log.model_dump())

    logger.debug("Frame %s: %s", detection_result.frame_index, detection_result.debug_info)

    return ObstacleDetectionResponse(
        obstacles=obstacles,
        safe_direction=detection_result.safe_direction,
        warning_level=detection_result.risk_level.value,
        audio_message=detection_result.audio_message,
    )


@router.get("/detection-pipeline/status/{session_id}")
async def get_pipeline_status(session_id: str):
    """Return coarse status for a session's detection pipeline."""
    pipeline = dependencies.get_pipeline(session_id)
    return {
        "session_id": session_id,
        "frame_count": pipeline.frame_index,
        "active_objects": len(pipeline.tracker.tracked_objects),
        "current_risk": pipeline.risk_engine.current_risk.value,
        "frame_history_size": len(pipeline.frame_history),
        "status": "active",
    }


@router.post("/detection-pipeline/clear/{session_id}")
async def clear_pipeline(session_id: str):
    """Drop pipeline state (call when a navigation session ends)."""
    dependencies.clear_pipeline(session_id)
    return {"message": f"Pipeline cleared for session {session_id}"}


@router.get("/detection-pipeline/debug/{session_id}")
async def get_pipeline_debug(session_id: str):
    """Return debug information from the most recent processed frame."""
    pipeline = dependencies.get_pipeline(session_id)

    if not pipeline.frame_history:
        return {"message": "No frames processed yet"}

    latest = pipeline.frame_history[-1]
    return {
        "frame_index": latest.frame_index,
        "timestamp": latest.timestamp,
        "debug_info": latest.debug_info,
        "risk_level": latest.risk_level.value,
        "safe_direction": latest.safe_direction,
        "alert_triggered": latest.alert_triggered,
        "alert_reason": latest.alert_reason.value if latest.alert_reason else None,
        "audio_message": latest.audio_message,
    }
