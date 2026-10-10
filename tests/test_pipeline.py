"""Unit tests for the temporal obstacle-detection pipeline.

These tests exercise the pipeline without FastAPI, MongoDB, or YOLO, so they run
with only the standard library available.
"""

from __future__ import annotations

from app.vision.pipeline import (
    BoundingBox,
    MotionState,
    RawDetection,
    RiskLevel,
    RobustDetectionPipeline,
)


def detection(cx: float, cy: float, w: float, h: float, conf: float = 0.9, name: str = "person"):
    return RawDetection(
        class_id=0,
        class_name=name,
        confidence=conf,
        bbox=BoundingBox(x1=cx - w / 2, y1=cy - h / 2, x2=cx + w / 2, y2=cy + h / 2),
        frame_width=640,
        frame_height=480,
    )


def run(pipeline: RobustDetectionPipeline, frames: int, dets):
    result = None
    for _ in range(frames):
        result = pipeline.process_frame(list(dets))
    return result


def test_bbox_center_and_area():
    bbox = BoundingBox(x1=0.0, y1=0.0, x2=0.5, y2=0.4)
    assert bbox.center == (0.25, 0.2)
    assert bbox.area == 0.2


def test_object_id_is_stable_across_frames():
    pipeline = RobustDetectionPipeline()
    result = run(pipeline, 3, [detection(0.5, 0.5, 0.2, 0.3)])

    assert len(result.tracked_objects) == 1
    assert result.tracked_objects[0].object_id == "obj_1"


def test_object_becomes_persistent_after_two_frames():
    pipeline = RobustDetectionPipeline()

    first = pipeline.process_frame([detection(0.5, 0.5, 0.2, 0.3)])
    assert first.tracked_objects[0].is_persistent is False

    second = pipeline.process_frame([detection(0.5, 0.5, 0.2, 0.3)])
    assert second.tracked_objects[0].is_persistent is True


def test_growing_object_is_classified_as_approaching():
    pipeline = RobustDetectionPipeline()
    pipeline.process_frame([detection(0.5, 0.5, 0.2, 0.2)])
    pipeline.process_frame([detection(0.5, 0.5, 0.3, 0.3)])

    result = pipeline.process_frame([detection(0.5, 0.5, 0.4, 0.4)])
    assert result.tracked_objects[0].motion_state == MotionState.APPROACHING
    assert result.risk_level == RiskLevel.DANGER


def test_right_side_obstacle_suggests_left():
    """Regression: normalized boxes must not be divided by pixel dimensions.

    Before the fix, every box was classified as far-left, which made the
    pipeline recommend walking *into* an obstacle on the right.
    """
    pipeline = RobustDetectionPipeline()
    result = run(pipeline, 2, [detection(0.9, 0.5, 0.3, 0.5)])

    assert result.safe_direction == "left"


def test_left_and_center_obstacles_suggest_right():
    pipeline = RobustDetectionPipeline()
    obstacles = [detection(0.1, 0.5, 0.3, 0.5), detection(0.5, 0.5, 0.3, 0.5)]
    result = run(pipeline, 2, obstacles)

    assert result.safe_direction == "right"


def test_being_surrounded_is_critical():
    pipeline = RobustDetectionPipeline()
    large = 0.9  # large boxes => "immediate"
    obstacles = [
        detection(0.1, 0.5, large, large),  # left
        detection(0.5, 0.5, large, large),  # front
        detection(0.9, 0.5, large, large),  # right
    ]
    result = run(pipeline, 3, obstacles)

    assert result.safe_direction == "stop"
    assert result.risk_level == RiskLevel.CRITICAL


def test_clear_path_is_safe():
    pipeline = RobustDetectionPipeline()
    result = pipeline.process_frame([])

    assert result.safe_direction == "forward"
    assert result.risk_level == RiskLevel.SAFE
