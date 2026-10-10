"""Temporal obstacle-detection pipeline.

Turns noisy per-frame YOLO detections into stable, consistent guidance:

- frame-to-frame tracking with persistent object IDs,
- a short temporal memory buffer,
- confidence smoothing,
- motion classification,
- a risk engine with hysteresis (no flicker between levels),
- alert de-duplication,
- fail-safe fallbacks (safety over silence).

Design priorities: *consistency over speed*, *persistence over instant
reaction*, *predictive warning over reactive alert*.

All bounding boxes are normalized to ``0.0 - 1.0`` (fraction of frame width /
height), so direction/distance thresholds are ratios rather than pixels.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum

from ..geometry import classify_direction, classify_distance

logger = logging.getLogger(__name__)


# ==================== ENUMS ====================


class MotionState(Enum):
    """Object motion classification."""

    STATIONARY = "stationary"
    MOVING_SIDEWAYS = "moving_sideways"
    APPROACHING = "approaching"
    RECEDING = "receding"


class RiskLevel(Enum):
    """Risk classification with hysteresis."""

    SAFE = "safe"
    CAUTION = "caution"
    DANGER = "danger"
    CRITICAL = "critical"


class AlertTriggerEvent(Enum):
    """Alert escalation events."""

    NEW_OBSTACLE = "new_obstacle"
    OBSTACLE_PERSISTS = "obstacle_persists"
    OBSTACLE_APPROACHING = "obstacle_approaching"
    OBSTACLE_CLEARED = "obstacle_cleared"
    CONFIDENCE_INCREASE = "confidence_increase"
    MOTION_DETECTED = "motion_detected"


# ==================== DATA CLASSES ====================


@dataclass
class BoundingBox:
    """Normalized bounding box (all values in 0..1)."""

    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    @property
    def area(self) -> float:
        return max((self.x2 - self.x1) * (self.y2 - self.y1), 0.0001)

    @property
    def height(self) -> float:
        return self.y2 - self.y1


@dataclass
class RawDetection:
    """A single-frame detection from YOLO."""

    class_id: int
    class_name: str
    confidence: float
    bbox: BoundingBox
    frame_width: int
    frame_height: int


@dataclass
class TrackedObject:
    """An object with temporal history and derived state."""

    object_id: str
    class_name: str
    frame_born: int
    last_seen_frame: int

    bbox_history: deque = field(default_factory=lambda: deque(maxlen=10))
    confidence_history: deque = field(default_factory=lambda: deque(maxlen=10))

    motion_state: MotionState = MotionState.STATIONARY
    velocity: tuple[float, float] = (0.0, 0.0)  # normalized units per frame
    area_growth_rate: float = 0.0  # relative area change per frame

    decay_counter: int = 0  # frames since last seen (temporal memory)
    visibility_streak: int = 0  # consecutive frames visible
    smoothed_confidence: float = 0.0
    is_persistent: bool = False  # visible and confident for N frames

    def add_detection(self, bbox: BoundingBox, confidence: float, frame_idx: int) -> None:
        """Update the object with a new detection."""
        self.bbox_history.append(bbox)
        self.confidence_history.append(confidence)
        self.last_seen_frame = frame_idx
        self.decay_counter = 0
        self.visibility_streak += 1
        self._update_motion_metrics()
        self._update_smoothed_confidence()

    def decay(self) -> None:
        """Increment the decay counter (object not seen this frame)."""
        self.decay_counter += 1

    def _update_motion_metrics(self) -> None:
        if len(self.bbox_history) < 2:
            return

        prev_bbox = self.bbox_history[-2]
        curr_bbox = self.bbox_history[-1]

        prev_center = prev_bbox.center
        curr_center = curr_bbox.center
        self.velocity = (
            curr_center[0] - prev_center[0],
            curr_center[1] - prev_center[1],
        )

        if prev_bbox.area > 0:
            self.area_growth_rate = (curr_bbox.area - prev_bbox.area) / prev_bbox.area

    def _update_smoothed_confidence(self) -> None:
        if not self.confidence_history:
            return
        self.smoothed_confidence = sum(self.confidence_history) / len(self.confidence_history)
        self.is_persistent = self.visibility_streak >= 2 and self.smoothed_confidence >= 0.35

    def classify_motion(self) -> MotionState:
        """Classify motion from area growth and horizontal velocity."""
        if len(self.bbox_history) < 2:
            self.motion_state = MotionState.STATIONARY
            return self.motion_state

        # Thresholds are in normalized units (fraction of frame per frame).
        velocity_threshold = 0.02
        growth_threshold = 0.05

        if self.area_growth_rate > growth_threshold:
            self.motion_state = MotionState.APPROACHING
        elif self.area_growth_rate < -growth_threshold:
            self.motion_state = MotionState.RECEDING
        elif abs(self.velocity[0]) > velocity_threshold:
            self.motion_state = MotionState.MOVING_SIDEWAYS
        else:
            self.motion_state = MotionState.STATIONARY

        return self.motion_state


@dataclass
class DetectionFrame:
    """Complete detection result for a single frame."""

    frame_index: int
    timestamp: float
    raw_detections: list[RawDetection]
    tracked_objects: list[TrackedObject]
    safe_direction: str
    risk_level: RiskLevel
    audio_message: str
    alert_triggered: bool
    alert_reason: AlertTriggerEvent | None = None
    debug_info: dict = field(default_factory=dict)


# ==================== OBJECT TRACKER ====================


class ObjectTracker:
    """Tracks objects across frames with persistent IDs.

    Matching is greedy: each detection attaches to the nearest same-class
    tracked object within a proximity and size tolerance.
    """

    def __init__(self, max_objects: int = 50, decay_threshold: int = 5):
        self.tracked_objects: dict[str, TrackedObject] = {}
        self.max_objects = max_objects
        self.decay_threshold = decay_threshold  # frames before removal
        self.next_object_id = 0
        self.match_distance_threshold = 0.2  # normalized center distance
        # Size is compared on the linear scale (sqrt of area) so that objects
        # growing/shrinking in area as they approach still keep their identity.
        self.match_scale_threshold = 0.5  # 50% linear size difference

    def update(self, raw_detections: list[RawDetection], frame_idx: int) -> list[TrackedObject]:
        """Match detections to tracked objects and update state."""
        for obj in self.tracked_objects.values():
            obj.decay()

        for detection in raw_detections:
            match_id = self._find_best_match(detection)
            if match_id:
                self.tracked_objects[match_id].add_detection(
                    detection.bbox, detection.confidence, frame_idx
                )
            else:
                new_id = self._create_new_id()
                new_obj = TrackedObject(
                    object_id=new_id,
                    class_name=detection.class_name,
                    frame_born=frame_idx,
                    last_seen_frame=frame_idx,
                )
                new_obj.add_detection(detection.bbox, detection.confidence, frame_idx)
                self.tracked_objects[new_id] = new_obj

        self._remove_stale_objects()
        return list(self.tracked_objects.values())

    def _remove_stale_objects(self) -> None:
        stale = [
            obj_id
            for obj_id, obj in self.tracked_objects.items()
            if obj.decay_counter > self.decay_threshold
        ]
        for obj_id in stale:
            logger.debug("Removing object %s after %d frame decay", obj_id, self.decay_threshold)
            del self.tracked_objects[obj_id]

    def _find_best_match(self, detection: RawDetection) -> str | None:
        candidates: list[tuple[float, str]] = []

        for obj_id, obj in self.tracked_objects.items():
            if obj.class_name != detection.class_name:
                continue
            if obj.decay_counter > 2:
                continue

            distance = self._bbox_distance(obj.bbox_history[-1], detection.bbox)
            prev_scale = obj.bbox_history[-1].area ** 0.5
            new_scale = detection.bbox.area**0.5
            scale_ratio = prev_scale / new_scale if new_scale > 0 else 0

            if (
                distance < self.match_distance_threshold
                and 1 - self.match_scale_threshold < scale_ratio < 1 + self.match_scale_threshold
            ):
                candidates.append((distance, obj_id))

        if not candidates:
            return None

        candidates.sort(key=lambda item: item[0])
        return candidates[0][1]

    @staticmethod
    def _bbox_distance(bbox1: BoundingBox, bbox2: BoundingBox) -> float:
        c1 = bbox1.center
        c2 = bbox2.center
        return ((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2) ** 0.5

    def _create_new_id(self) -> str:
        self.next_object_id += 1
        return f"obj_{self.next_object_id}"

    def reset(self) -> None:
        self.tracked_objects.clear()
        self.next_object_id = 0


# ==================== MOTION CLASSIFIER ====================


class MotionClassifier:
    """Classify object motion state."""

    @staticmethod
    def classify(obj: TrackedObject) -> MotionState:
        return obj.classify_motion()


# ==================== STABLE RISK DECISION ENGINE ====================


class StableRiskDecisionEngine:
    """Determines risk level with hysteresis and multi-frame validation.

    Prevents flickering between risk levels. All inputs are normalized boxes.
    """

    def __init__(self):
        self.current_risk = RiskLevel.SAFE
        self.risk_persistance_counter = 0
        self.risk_persistance_threshold = {
            RiskLevel.SAFE: 3,  # must stay safe for 3 frames
            RiskLevel.CAUTION: 1,  # caution can change immediately
            RiskLevel.DANGER: 2,  # must stay danger for 2 frames
            RiskLevel.CRITICAL: 2,  # must stay critical for 2 frames
        }

    def evaluate(self, tracked_objects: list[TrackedObject]) -> tuple[RiskLevel, str, bool]:
        """Return ``(risk_level, safe_direction, should_trigger_alert)``."""
        persistent = [obj for obj in tracked_objects if obj.is_persistent]

        if not persistent:
            return self._transition_risk(RiskLevel.SAFE), "forward", False

        blocked_directions = {"left": 0, "forward": 0, "right": 0}
        immediate_front = False

        for obj in persistent:
            bbox = obj.bbox_history[-1]
            distance = classify_distance(bbox.area)
            direction = classify_direction(bbox.center[0])

            weight = 2 if distance == "immediate" else 1
            if direction in ("left", "front-left"):
                blocked_directions["left"] += weight
            elif direction in ("right", "front-right"):
                blocked_directions["right"] += weight
            else:
                blocked_directions["forward"] += weight
                if distance == "immediate":
                    immediate_front = True

        if immediate_front and blocked_directions["left"] > 0 and blocked_directions["right"] > 0:
            safe_direction = "stop"
            new_risk = RiskLevel.CRITICAL
        else:
            safe_direction = min(blocked_directions, key=blocked_directions.get)

            if any(MotionClassifier.classify(o) == MotionState.APPROACHING for o in persistent):
                new_risk = RiskLevel.DANGER
            elif len(persistent) >= 3 or any(o.smoothed_confidence > 0.85 for o in persistent):
                new_risk = RiskLevel.CAUTION
            else:
                new_risk = RiskLevel.SAFE

        final_risk, should_trigger = self._apply_hysteresis(new_risk)
        return final_risk, safe_direction, should_trigger

    def _transition_risk(self, new_risk: RiskLevel) -> RiskLevel:
        """Apply hysteresis when transitioning risk levels."""
        if new_risk == self.current_risk:
            self.risk_persistance_counter = 0
            return self.current_risk

        threshold = self.risk_persistance_threshold.get(new_risk, 1)
        self.risk_persistance_counter += 1

        if self.risk_persistance_counter >= threshold:
            self.current_risk = new_risk
            self.risk_persistance_counter = 0
            logger.info("Risk transitioned to %s", new_risk.value)

        return self.current_risk

    def _apply_hysteresis(self, new_risk: RiskLevel) -> tuple[RiskLevel, bool]:
        """Apply hysteresis and report whether an alert should fire."""
        should_trigger = False

        if new_risk != self.current_risk:
            threshold = self.risk_persistance_threshold.get(new_risk, 1)
            self.risk_persistance_counter += 1

            if self.risk_persistance_counter >= threshold:
                self.current_risk = new_risk
                self.risk_persistance_counter = 0
                should_trigger = True
                logger.info("Risk transitioned to %s - ALERT TRIGGERED", new_risk.value)
        else:
            self.risk_persistance_counter = 0

        return self.current_risk, should_trigger


# ==================== ALERT MANAGER ====================


class AlertManager:
    """Builds spoken alerts and de-duplicates repeated messages."""

    def __init__(self):
        self.last_alert_message = ""

    def generate_alert(
        self,
        risk_level: RiskLevel,
        tracked_objects: list[TrackedObject],
        safe_direction: str,
        force_new: bool = False,
    ) -> tuple[str, AlertTriggerEvent | None]:
        """Return ``(message, event)`` or ``("", None)`` if the alert is a repeat."""
        if risk_level == RiskLevel.CRITICAL:
            message = self._build_critical_message(tracked_objects, safe_direction)
            event = AlertTriggerEvent.OBSTACLE_APPROACHING
        elif risk_level == RiskLevel.DANGER:
            message = self._build_danger_message(tracked_objects, safe_direction)
            event = AlertTriggerEvent.OBSTACLE_PERSISTS
        elif risk_level == RiskLevel.CAUTION:
            message = self._build_caution_message(tracked_objects, safe_direction)
            event = AlertTriggerEvent.MOTION_DETECTED
        else:
            message = "Path looks clear. Continue forward."
            event = AlertTriggerEvent.OBSTACLE_CLEARED

        if message == self.last_alert_message and not force_new:
            return "", None

        self.last_alert_message = message
        return message, event

    def _build_critical_message(self, objects: list[TrackedObject], direction: str) -> str:
        persistent = [o for o in objects if o.is_persistent]
        if not persistent:
            return "Critical risk. Stop immediately."

        primary = persistent[0].class_name
        turn_hint = {
            "left": "Turn left immediately.",
            "right": "Turn right immediately.",
            "forward": "Back up immediately.",
            "stop": "Stop. You are blocked.",
        }.get(direction, f"Move {direction} immediately.")

        return f"CRITICAL. {primary} blocking path. {turn_hint}"

    def _build_danger_message(self, objects: list[TrackedObject], direction: str) -> str:
        persistent = [o for o in objects if o.is_persistent]
        if not persistent:
            return "Danger ahead. Proceed carefully."

        obstacle_types = ", ".join(o.class_name for o in persistent[:2])
        turn_hint = {
            "left": "Turn left carefully.",
            "right": "Turn right carefully.",
            "forward": "Continue forward with caution.",
            "stop": "Stop and reassess.",
        }.get(direction, f"Move {direction} carefully.")

        return f"Danger: {obstacle_types} ahead. {turn_hint}"

    def _build_caution_message(self, objects: list[TrackedObject], direction: str) -> str:
        persistent = [o for o in objects if o.is_persistent]
        count = len(persistent)

        if count == 0:
            return "Caution. Possible obstacles detected."
        if count == 1:
            return f"Caution. {persistent[0].class_name} detected. Proceed slowly."
        return f"Caution. Multiple obstacles detected ({count}). Proceed slowly."


# ==================== ADAPTIVE DETECTION SCHEDULER ====================


class AdaptiveDetectionScheduler:
    """Suggested detection interval for a given risk level.

    Lower risk tolerates slower sampling; high risk implies near-continuous
    detection. Exposed for clients that drive their own capture loop.
    """

    def __init__(self):
        self.detection_intervals = {
            RiskLevel.SAFE: 3.0,
            RiskLevel.CAUTION: 1.5,
            RiskLevel.DANGER: 0.75,
            RiskLevel.CRITICAL: 0.5,
        }

    def get_next_interval(self, current_risk: RiskLevel) -> float:
        return self.detection_intervals.get(current_risk, 3.0)


# ==================== FAIL-SAFE MANAGER ====================


class FailSafeManager:
    """When uncertain, assume risk. Safety over silence."""

    @staticmethod
    def get_fallback_response(error_type: str) -> tuple[str, RiskLevel]:
        """Return a conservative ``(audio_message, risk_level)`` on failure."""
        fallback_responses = {
            "image_invalid": (
                "Unable to analyze image. Obstacle detection uncertain. Move slowly.",
                RiskLevel.CAUTION,
            ),
            "model_unavailable": (
                "Detection system offline. Proceed with caution.",
                RiskLevel.CAUTION,
            ),
            "inference_timeout": (
                "Detection taking too long. Use caution ahead.",
                RiskLevel.CAUTION,
            ),
            "network_error": (
                "Backend unavailable. Using local safety mode.",
                RiskLevel.CAUTION,
            ),
            "unknown_error": (
                "Detection system error. Stop and reassess your surroundings.",
                RiskLevel.DANGER,
            ),
        }
        return fallback_responses.get(error_type, fallback_responses["unknown_error"])


# ==================== ROBUST DETECTION PIPELINE ====================


class RobustDetectionPipeline:
    """Orchestrates tracking, motion, risk, and alerting per session."""

    def __init__(self):
        self.tracker = ObjectTracker()
        self.risk_engine = StableRiskDecisionEngine()
        self.alert_manager = AlertManager()
        self.scheduler = AdaptiveDetectionScheduler()
        self.frame_index = 0
        self.frame_history: deque = deque(maxlen=10)

    def process_frame(self, raw_detections: list[RawDetection]) -> DetectionFrame:
        """Run one frame through the pipeline and return the analysis result."""
        try:
            self.frame_index += 1
            timestamp = time.time()

            tracked_objects = self.tracker.update(raw_detections, self.frame_index)
            for obj in tracked_objects:
                MotionClassifier.classify(obj)

            risk_level, safe_direction, should_trigger_alert = self.risk_engine.evaluate(
                tracked_objects
            )

            alert_message, alert_event = self.alert_manager.generate_alert(
                risk_level,
                tracked_objects,
                safe_direction,
                force_new=should_trigger_alert,
            )

            result = DetectionFrame(
                frame_index=self.frame_index,
                timestamp=timestamp,
                raw_detections=raw_detections,
                tracked_objects=tracked_objects,
                safe_direction=safe_direction,
                risk_level=risk_level,
                audio_message=alert_message or self._continuation_message(risk_level),
                alert_triggered=bool(alert_message),
                alert_reason=alert_event,
                debug_info=self._build_debug_info(tracked_objects, risk_level),
            )
            self.frame_history.append(result)
            return result

        except Exception as exc:  # fail-safe: assume danger
            logger.error("Pipeline error: %s", exc, exc_info=True)
            return DetectionFrame(
                frame_index=self.frame_index,
                timestamp=time.time(),
                raw_detections=[],
                tracked_objects=[],
                safe_direction="stop",
                risk_level=RiskLevel.DANGER,
                audio_message="Detection system error. Stop and reassess your surroundings.",
                alert_triggered=True,
                alert_reason=AlertTriggerEvent.OBSTACLE_APPROACHING,
                debug_info={"error": str(exc)},
            )

    @staticmethod
    def _continuation_message(risk_level: RiskLevel) -> str:
        if risk_level == RiskLevel.SAFE:
            return "Path clear. Continue forward."
        if risk_level == RiskLevel.CAUTION:
            return "Proceed with caution."
        return "Be alert."

    @staticmethod
    def _build_debug_info(tracked_objects: list[TrackedObject], risk_level: RiskLevel) -> dict:
        persistent = [o for o in tracked_objects if o.is_persistent]
        return {
            "total_objects": len(tracked_objects),
            "persistent_objects": len(persistent),
            "objects": [
                {
                    "id": o.object_id,
                    "class": o.class_name,
                    "confidence": round(o.smoothed_confidence, 3),
                    "motion": o.motion_state.value,
                    "visibility": o.visibility_streak,
                    "persistence": o.is_persistent,
                }
                for o in tracked_objects[:10]
            ],
            "risk_level": risk_level.value,
        }

    def reset(self) -> None:
        self.tracker.reset()
        self.frame_index = 0
        self.frame_history.clear()
