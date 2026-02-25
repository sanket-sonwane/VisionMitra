"""
Production-Grade Robust Obstacle Detection Pipeline
====================================================

Implements:
- Frame-to-frame object tracking with persistent IDs
- Temporal memory buffer (N-frame history)
- Confidence smoothing (moving average)
- Motion classification (approaching/moving/stationary)
- Stable risk decision engine with hysteresis
- Alert escalation with deduplication
- Adaptive detection frequency
- Fail-safe fallback logic
- Debug telemetry logging

System prioritizes:
- CONSISTENCY over speed
- PERSISTENCE over instant reaction
- PREDICTIVE warning over reactive alert
- SAFETY over silence
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from collections import deque
from abc import ABC, abstractmethod
import time
import logging
from enum import Enum

logger = logging.getLogger(__name__)


# ==================== ENUMS ====================

class MotionState(Enum):
    """Object motion classification"""
    STATIONARY = "stationary"
    MOVING_SIDEWAYS = "moving_sideways"
    APPROACHING = "approaching"
    RECEDING = "receding"


class RiskLevel(Enum):
    """Risk classification with hysteresis"""
    SAFE = "safe"
    CAUTION = "caution"
    DANGER = "danger"
    CRITICAL = "critical"


class AlertTriggerEvent(Enum):
    """Alert escalation events"""
    NEW_OBSTACLE = "new_obstacle"
    OBSTACLE_PERSISTS = "obstacle_persists"
    OBSTACLE_APPROACHING = "obstacle_approaching"
    OBSTACLE_CLEARED = "obstacle_cleared"
    CONFIDENCE_INCREASE = "confidence_increase"
    MOTION_DETECTED = "motion_detected"


# ==================== DATA CLASSES ====================

@dataclass
class BoundingBox:
    """Normalized bounding box representation"""
    x1: float
    y1: float
    x2: float
    y2: float
    
    @property
    def center(self) -> Tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)
    
    @property
    def area(self) -> float:
        return max((self.x2 - self.x1) * (self.y2 - self.y1), 0.0001)
    
    @property
    def height(self) -> float:
        return self.y2 - self.y1


@dataclass
class RawDetection:
    """Single-frame detection from YOLO"""
    class_id: int
    class_name: str
    confidence: float
    bbox: BoundingBox
    frame_width: int
    frame_height: int


@dataclass
class TrackedObject:
    """Object with temporal history and state"""
    object_id: str
    class_name: str
    frame_born: int  # Frame where first detected
    last_seen_frame: int
    
    # Bounding box history (deque of last N frames)
    bbox_history: deque = field(default_factory=lambda: deque(maxlen=10))
    
    # Confidence history
    confidence_history: deque = field(default_factory=lambda: deque(maxlen=10))
    
    # Motion state
    motion_state: MotionState = MotionState.STATIONARY
    velocity: Tuple[float, float] = (0.0, 0.0)  # pixels per frame
    area_growth_rate: float = 0.0  # relative growth per frame
    
    # Decay timer (for temporary occlusion)
    decay_counter: int = 0  # Frames since last seen
    visibility_streak: int = 0  # Consecutive frames visible
    
    # Smoothed metrics
    smoothed_confidence: float = 0.0
    is_persistent: bool = False  # True if visible for N+ frames
    
    def add_detection(self, bbox: BoundingBox, confidence: float, frame_idx: int):
        """Update object with new detection"""
        self.bbox_history.append(bbox)
        self.confidence_history.append(confidence)
        self.last_seen_frame = frame_idx
        self.decay_counter = 0
        self.visibility_streak += 1
        self._update_motion_metrics()
        self._update_smoothed_confidence()
    
    def decay(self):
        """Increment decay counter (temporal memory)"""
        self.decay_counter += 1
    
    def _update_motion_metrics(self):
        """Compute velocity and area growth"""
        if len(self.bbox_history) < 2:
            return
        
        prev_bbox = self.bbox_history[-2]
        curr_bbox = self.bbox_history[-1]
        
        # Velocity (pixels per frame)
        prev_center = prev_bbox.center
        curr_center = curr_bbox.center
        self.velocity = (
            curr_center[0] - prev_center[0],
            curr_center[1] - prev_center[1]
        )
        
        # Area growth rate
        if prev_bbox.area > 0:
            self.area_growth_rate = (curr_bbox.area - prev_bbox.area) / prev_bbox.area
    
    def _update_smoothed_confidence(self):
        """Moving average of confidence scores"""
        if not self.confidence_history:
            return
        self.smoothed_confidence = sum(self.confidence_history) / len(self.confidence_history)
        self.is_persistent = (
            self.visibility_streak >= 2 and  # At least 2 frames
            self.smoothed_confidence >= 0.35  # Min confidence
        )
    
    def classify_motion(self) -> MotionState:
        """Classify motion state based on velocity and growth"""
        if len(self.bbox_history) < 2:
            self.motion_state = MotionState.STATIONARY
            return self.motion_state
        
        # Thresholds
        VELOCITY_THRESHOLD = 5.0  # pixels per frame
        GROWTH_THRESHOLD = 0.05  # 5% area change
        
        # Check growth (approaching/receding)
        if self.area_growth_rate > GROWTH_THRESHOLD:
            self.motion_state = MotionState.APPROACHING
        elif self.area_growth_rate < -GROWTH_THRESHOLD:
            self.motion_state = MotionState.RECEDING
        # Check horizontal movement
        elif abs(self.velocity[0]) > VELOCITY_THRESHOLD:
            self.motion_state = MotionState.MOVING_SIDEWAYS
        else:
            self.motion_state = MotionState.STATIONARY
        
        return self.motion_state


@dataclass
class DetectionFrame:
    """Complete detection result for single frame"""
    frame_index: int
    timestamp: float
    raw_detections: List[RawDetection]
    tracked_objects: List[TrackedObject]
    safe_direction: str
    risk_level: RiskLevel
    audio_message: str
    alert_triggered: bool
    alert_reason: Optional[AlertTriggerEvent] = None
    debug_info: Dict = field(default_factory=dict)


# ==================== OBJECT TRACKER ====================

class ObjectTracker:
    """Tracks objects across frames with persistent IDs"""
    
    def __init__(self, max_objects: int = 50, decay_threshold: int = 5):
        self.tracked_objects: Dict[str, TrackedObject] = {}
        self.max_objects = max_objects
        self.decay_threshold = decay_threshold  # Frames before removal
        self.next_object_id = 0
        self.match_distance_threshold = 50.0  # pixels
        self.match_size_threshold = 0.3  # 30% size difference
    
    def update(self, raw_detections: List[RawDetection], frame_idx: int) -> List[TrackedObject]:
        """Match detections to tracked objects and update states"""
        
        # Increase decay counter for all objects
        for obj in self.tracked_objects.values():
            obj.decay()
        
        # Match detections to tracked objects
        matched_ids = set()
        for detection in raw_detections:
            match_id = self._find_best_match(detection)
            
            if match_id:
                # Update existing tracked object
                self.tracked_objects[match_id].add_detection(
                    detection.bbox,
                    detection.confidence,
                    frame_idx
                )
                matched_ids.add(match_id)
            else:
                # Create new tracked object
                new_id = self._create_new_id()
                new_obj = TrackedObject(
                    object_id=new_id,
                    class_name=detection.class_name,
                    frame_born=frame_idx,
                    last_seen_frame=frame_idx
                )
                new_obj.add_detection(detection.bbox, detection.confidence, frame_idx)
                self.tracked_objects[new_id] = new_obj
        
        # Remove objects beyond decay threshold
        to_remove = [
            obj_id for obj_id, obj in self.tracked_objects.items()
            if obj.decay_counter > self.decay_threshold
        ]
        for obj_id in to_remove:
            logger.debug(f"Removing object {obj_id} after {self.decay_threshold} frame decay")
            del self.tracked_objects[obj_id]
        
        return list(self.tracked_objects.values())
    
    def _find_best_match(self, detection: RawDetection) -> Optional[str]:
        """Find best matching tracked object for detection"""
        candidates = []
        
        for obj_id, obj in self.tracked_objects.items():
            # Same class name required
            if obj.class_name != detection.class_name:
                continue
            
            # Skip if decay is too high (object likely gone)
            if obj.decay_counter > 2:
                continue
            
            # Compute match score
            distance = self._bbox_distance(obj.bbox_history[-1], detection.bbox)
            size_ratio = obj.bbox_history[-1].area / detection.bbox.area if detection.bbox.area > 0 else 0
            
            if distance < self.match_distance_threshold and 1 - self.match_size_threshold < size_ratio < 1 + self.match_size_threshold:
                candidates.append((distance, obj_id))
        
        if not candidates:
            return None
        
        # Return best match (lowest distance)
        candidates.sort(key=lambda x: x[0])
        return candidates[0][1]
    
    def _bbox_distance(self, bbox1: BoundingBox, bbox2: BoundingBox) -> float:
        """Euclidean distance between bounding box centers"""
        c1 = bbox1.center
        c2 = bbox2.center
        return ((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2) ** 0.5
    
    def _create_new_id(self) -> str:
        """Generate unique object ID"""
        self.next_object_id += 1
        return f"obj_{self.next_object_id}"
    
    def reset(self):
        """Clear all tracked objects"""
        self.tracked_objects.clear()
        self.next_object_id = 0


# ==================== MOTION CLASSIFIER ====================

class MotionClassifier:
    """Classify object motion state and predict trajectory"""
    
    @staticmethod
    def classify(obj: TrackedObject) -> MotionState:
        """Classify motion state"""
        return obj.classify_motion()
    
    @staticmethod
    def is_approaching(obj: TrackedObject, frame_center_y: float) -> bool:
        """Heuristic: object approaching if moving toward center-bottom"""
        if obj.motion_state != MotionState.APPROACHING:
            return False
        
        # Approaching if area increasing + moving toward bottom
        if len(obj.bbox_history) < 2:
            return False
        
        center_y = obj.bbox_history[-1].center[1]
        return center_y > frame_center_y and obj.area_growth_rate > 0.03


# ==================== STABLE RISK DECISION ENGINE ====================

class StableRiskDecisionEngine:
    """
    Determines risk level with hysteresis and multi-frame validation.
    Prevents flickering between risk levels.
    """
    
    def __init__(self):
        self.current_risk = RiskLevel.SAFE
        self.risk_persistance_counter = 0
        self.risk_persistance_threshold = {
            RiskLevel.SAFE: 3,      # Must stay safe for 3 frames
            RiskLevel.CAUTION: 1,   # Caution can change immediately
            RiskLevel.DANGER: 2,    # Must stay danger for 2 frames
            RiskLevel.CRITICAL: 2  # Must stay critical for 2 frames
        }
    
    def evaluate(self, tracked_objects: List[TrackedObject], frame_width: int, frame_height: int) -> Tuple[RiskLevel, str, bool]:
        """
        Evaluate risk level based on persistent objects.
        
        Returns:
            (risk_level, safe_direction, should_trigger_alert)
        """
        
        # Filter to persistent objects only
        persistent = [obj for obj in tracked_objects if obj.is_persistent]
        
        if not persistent:
            return self._transition_risk(RiskLevel.SAFE), "forward", False
        
        # Analyze persistent objects
        frame_center_x = frame_width / 2
        frame_center_y = frame_height / 2
        blocked_directions = {"left": 0, "forward": 0, "right": 0}
        immediate_front = False
        approaching_detected = False
        
        for obj in persistent:
            center_x = obj.bbox_history[-1].center[0]
            area_ratio = obj.bbox_history[-1].area / (frame_width * frame_height)
            
            # Distance classification
            if area_ratio >= 0.24:
                distance = "immediate"
            elif area_ratio >= 0.08:
                distance = "near"
            else:
                distance = "far"
            
            # Direction classification
            ratio = center_x / max(frame_width, 1)
            if ratio < 0.25:
                direction = "left"
            elif ratio < 0.42:
                direction = "front-left"
            elif ratio <= 0.58:
                direction = "front"
            else:
                direction = "front-right" if ratio <= 0.75 else "right"
            
            # Weight by distance
            weight = 2 if distance == "immediate" else 1
            
            if direction in ["left", "front-left"]:
                blocked_directions["left"] += weight
            elif direction in ["right", "front-right"]:
                blocked_directions["right"] += weight
            else:
                blocked_directions["forward"] += weight
                if distance == "immediate":
                    immediate_front = True
            
            # Check motion
            if MotionClassifier.is_approaching(obj, frame_center_y):
                approaching_detected = True
        
        # Determine safe direction
        if immediate_front and blocked_directions["left"] > 0 and blocked_directions["right"] > 0:
            safe_direction = "stop"
        else:
            safe_direction = min(blocked_directions, key=blocked_directions.get)
        
        # Determine risk level
        if immediate_front and blocked_directions["left"] > 0 and blocked_directions["right"] > 0:
            new_risk = RiskLevel.CRITICAL
        elif any(o.is_persistent and MotionClassifier.classify(o) == MotionState.APPROACHING for o in persistent):
            new_risk = RiskLevel.DANGER
        elif len(persistent) >= 3 or any(o.smoothed_confidence > 0.85 for o in persistent):
            new_risk = RiskLevel.CAUTION
        else:
            new_risk = RiskLevel.SAFE
        
        # Apply hysteresis
        final_risk, should_trigger = self._apply_hysteresis(new_risk)
        
        return final_risk, safe_direction, should_trigger
    
    def _transition_risk(self, new_risk: RiskLevel) -> RiskLevel:
        """Apply hysteresis when transitioning risk levels"""
        if new_risk == self.current_risk:
            self.risk_persistance_counter = 0
            return self.current_risk
        
        threshold = self.risk_persistance_threshold.get(new_risk, 1)
        self.risk_persistance_counter += 1
        
        if self.risk_persistance_counter >= threshold:
            self.current_risk = new_risk
            self.risk_persistance_counter = 0
            logger.info(f"Risk transitioned to {new_risk.value}")
        
        return self.current_risk
    
    def _apply_hysteresis(self, new_risk: RiskLevel) -> Tuple[RiskLevel, bool]:
        """Apply hysteresis and determine if alert should trigger"""
        should_trigger = False
        
        if new_risk != self.current_risk:
            threshold = self.risk_persistance_threshold.get(new_risk, 1)
            self.risk_persistance_counter += 1
            
            if self.risk_persistance_counter >= threshold:
                self.current_risk = new_risk
                self.risk_persistance_counter = 0
                should_trigger = True
                logger.info(f"Risk transitioned to {new_risk.value} - ALERT TRIGGERED")
        else:
            self.risk_persistance_counter = 0
        
        return self.current_risk, should_trigger


# ==================== ALERT MANAGER ====================

class AlertManager:
    """
    Manages alert escalation and deduplication.
    Follows escalation logic:
    - New obstacle: announce once
    - Persists: remind after interval
    - Approaching: urgent warning
    - Cleared: announce clear
    """
    
    def __init__(self, reminder_interval: int = 10):
        self.last_alert_message = ""
        self.last_alert_time = 0.0
        self.reminder_interval = reminder_interval  # frames
        self.active_obstacles = {}  # object_id -> alert_count
        self.cleared_obstacles = set()  # Recently cleared IDs
    
    def generate_alert(
        self,
        risk_level: RiskLevel,
        tracked_objects: List[TrackedObject],
        safe_direction: str,
        force_new: bool = False
    ) -> Tuple[str, Optional[AlertTriggerEvent]]:
        """
        Generate alert message and determine if should announce.
        
        Returns:
            (message, alert_event) or ("", None) if no new alert needed
        """
        
        # Build message
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
        
        # Deduplication: don't repeat same message immediately
        if message == self.last_alert_message and not force_new:
            return "", None
        
        self.last_alert_message = message
        self.last_alert_time = time.time()
        
        return message, event
    
    def _build_critical_message(self, objects: List[TrackedObject], direction: str) -> str:
        persistent = [o for o in objects if o.is_persistent]
        if not persistent:
            return "Critical risk. Stop immediately."
        
        primary = persistent[0].class_name
        turn_hint = {
            "left": "Turn left immediately.",
            "right": "Turn right immediately.",
            "forward": "Back up immediately.",
            "stop": "Stop. You are blocked."
        }.get(direction, f"Move {direction} immediately.")
        
        return f"CRITICAL. {primary} blocking path. {turn_hint}"
    
    def _build_danger_message(self, objects: List[TrackedObject], direction: str) -> str:
        persistent = [o for o in objects if o.is_persistent]
        if not persistent:
            return "Danger ahead. Proceed carefully."
        
        obstacle_types = ", ".join([o.class_name for o in persistent[:2]])
        turn_hint = {
            "left": "Turn left carefully.",
            "right": "Turn right carefully.",
            "forward": "Continue forward with caution.",
            "stop": "Stop and reassess."
        }.get(direction, f"Move {direction} carefully.")
        
        return f"Danger: {obstacle_types} ahead. {turn_hint}"
    
    def _build_caution_message(self, objects: List[TrackedObject], direction: str) -> str:
        persistent = [o for o in objects if o.is_persistent]
        count = len(persistent)
        
        if count == 0:
            return "Caution. Possible obstacles detected."
        elif count == 1:
            return f"Caution. {persistent[0].class_name} detected. Proceed slowly."
        else:
            return f"Caution. Multiple obstacles detected ({count}). Proceed slowly."


# ==================== ADAPTIVE DETECTION SCHEDULER ====================

class AdaptiveDetectionScheduler:
    """Adaptively adjust detection frequency based on risk level"""
    
    def __init__(self):
        self.detection_intervals = {
            RiskLevel.SAFE: 3.0,      # 3 seconds
            RiskLevel.CAUTION: 1.5,   # 1.5 seconds
            RiskLevel.DANGER: 0.75,   # 750 ms
            RiskLevel.CRITICAL: 0.5   # 500 ms (continuous)
        }
    
    def get_next_interval(self, current_risk: RiskLevel) -> float:
        """Get detection interval for current risk level"""
        return self.detection_intervals.get(current_risk, 3.0)


# ==================== FAIL-SAFE MANAGER ====================

class FailSafeManager:
    """
    Fail-safe logic: when uncertain, assume risk.
    Safety > silence.
    """
    
    @staticmethod
    def get_fallback_response(error_type: str) -> Tuple[str, RiskLevel]:
        """
        Return conservative fallback when detection fails.
        
        Args:
            error_type: Type of failure
        
        Returns:
            (audio_message, risk_level)
        """
        
        fallback_responses = {
            "image_invalid": (
                "Unable to analyze image. Obstacle detection uncertain. Move slowly.",
                RiskLevel.CAUTION
            ),
            "model_unavailable": (
                "Detection system offline. Proceed with caution.",
                RiskLevel.CAUTION
            ),
            "inference_timeout": (
                "Detection taking too long. Use caution ahead.",
                RiskLevel.CAUTION
            ),
            "network_error": (
                "Backend unavailable. Using local safety mode.",
                RiskLevel.CAUTION
            ),
            "unknown_error": (
                "Detection system error. Stop and reassess your surroundings.",
                RiskLevel.DANGER
            )
        }
        
        return fallback_responses.get(error_type, fallback_responses["unknown_error"])


# ==================== ROBUST DETECTION PIPELINE ====================

class RobustDetectionPipeline:
    """
    Main orchestrator combining all components.
    Produces stable, consistent perceptual output.
    """
    
    def __init__(self):
        self.tracker = ObjectTracker()
        self.risk_engine = StableRiskDecisionEngine()
        self.alert_manager = AlertManager()
        self.scheduler = AdaptiveDetectionScheduler()
        self.frame_index = 0
        self.frame_history: deque = deque(maxlen=10)
    
    def process_frame(
        self,
        raw_detections: List[RawDetection],
        frame_width: int,
        frame_height: int,
        previous_risk: Optional[RiskLevel] = None
    ) -> DetectionFrame:
        """
        Process single frame through robust pipeline.
        
        Returns:
            DetectionFrame with all analysis results
        """
        
        try:
            # Update frame index
            self.frame_index += 1
            timestamp = time.time()
            
            # Step 1: Track objects across frames
            tracked_objects = self.tracker.update(raw_detections, self.frame_index)
            
            # Step 2: Classify motion for all objects
            for obj in tracked_objects:
                MotionClassifier.classify(obj)
            
            # Step 3: Evaluate risk with hysteresis
            risk_level, safe_direction, should_trigger_alert = self.risk_engine.evaluate(
                tracked_objects,
                frame_width,
                frame_height
            )
            
            # Step 4: Generate alert message
            alert_message, alert_event = self.alert_manager.generate_alert(
                risk_level,
                tracked_objects,
                safe_direction,
                force_new=should_trigger_alert
            )
            
            # Create detection frame result
            result = DetectionFrame(
                frame_index=self.frame_index,
                timestamp=timestamp,
                raw_detections=raw_detections,
                tracked_objects=tracked_objects,
                safe_direction=safe_direction,
                risk_level=risk_level,
                audio_message=alert_message or self._get_continuation_message(risk_level),
                alert_triggered=bool(alert_message),
                alert_reason=alert_event,
                debug_info=self._build_debug_info(tracked_objects, risk_level)
            )
            
            # Store frame in history
            self.frame_history.append(result)
            
            logger.debug(f"Frame {self.frame_index}: Risk={risk_level.value}, Objects={len(tracked_objects)}, Alert={result.alert_triggered}")
            
            return result
        
        except Exception as e:
            logger.error(f"Pipeline error: {str(e)}")
            # Fail-safe: assume danger
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
                debug_info={"error": str(e)}
            )
    
    def _get_continuation_message(self, risk_level: RiskLevel) -> str:
        """Message to repeat if no new alert"""
        if risk_level == RiskLevel.SAFE:
            return "Path clear. Continue forward."
        elif risk_level == RiskLevel.CAUTION:
            return "Proceed with caution."
        else:
            return "Be alert."
    
    def _build_debug_info(self, tracked_objects: List[TrackedObject], risk_level: RiskLevel) -> Dict:
        """Build debug telemetry"""
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
                    "persistence": o.is_persistent
                }
                for o in tracked_objects[:10]  # Log top 10
            ],
            "risk_level": risk_level.value
        }
    
    def reset(self):
        """Reset pipeline state"""
        self.tracker.reset()
        self.frame_index = 0
        self.frame_history.clear()
