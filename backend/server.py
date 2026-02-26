from fastapi import FastAPI, APIRouter, HTTPException, File, UploadFile
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime
import base64
import asyncio
from threading import Lock
try:
    from robust_detection_pipeline import (
        RobustDetectionPipeline,
        RawDetection,
        BoundingBox,
        RiskLevel,
        FailSafeManager
    )
except ImportError:
    from .robust_detection_pipeline import (
        RobustDetectionPipeline,
        RawDetection,
        BoundingBox,
        RiskLevel,
        FailSafeManager
    )

try:
    import numpy as np
except Exception:
    np = None

try:
    import cv2
    CV2_AVAILABLE = True
except Exception:
    cv2 = None
    CV2_AVAILABLE = False

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

ENABLE_VISION_AI = os.environ.get('ENABLE_VISION_AI', '0').lower() in ['1', 'true', 'yes']
YOLO_AVAILABLE = ENABLE_VISION_AI and CV2_AVAILABLE and np is not None

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'test_database')]

YOLO_MODEL_PATH = os.environ.get('YOLO_MODEL_PATH', 'yolov8n.pt')
YOLO_CONF_THRESHOLD = float(os.environ.get('YOLO_CONF_THRESHOLD', '0.35'))
_yolo_model = None
_yolo_lock = Lock()

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# ==================== ROBUST PIPELINE STATE ====================
# One pipeline per session for consistent temporal tracking
_session_pipelines: Dict[str, RobustDetectionPipeline] = {}
_pipeline_lock = Lock()

def get_session_pipeline(session_id: str) -> RobustDetectionPipeline:
    """Get or create pipeline for session"""
    if session_id not in _session_pipelines:
        with _pipeline_lock:
            if session_id not in _session_pipelines:
                _session_pipelines[session_id] = RobustDetectionPipeline()
                logger.info(f"Created new pipeline for session {session_id}")
    return _session_pipelines[session_id]

def clear_session_pipeline(session_id: str):
    """Clear pipeline when session ends"""
    with _pipeline_lock:
        if session_id in _session_pipelines:
            del _session_pipelines[session_id]
            logger.info(f"Cleared pipeline for session {session_id}")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== MODELS ====================

class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    phone: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(BaseModel):
    name: str
    phone: str

class EmergencyContact(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    phone: str
    relationship: str
    priority: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)

class EmergencyContactCreate(BaseModel):
    user_id: str
    name: str
    phone: str
    relationship: str
    priority: int = 1

class NavigationSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    start_location: dict
    destination: Optional[dict] = None
    destination_name: Optional[str] = None
    journey_plan: Optional[dict] = None  # Full journey plan with segments
    current_segment_index: int = 0  # Track which segment user is on
    status: str = "active"  # active, completed, cancelled
    mode: str = "online"  # online, offline
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

class NavigationSessionCreate(BaseModel):
    user_id: str
    start_location: dict
    destination: Optional[dict] = None
    destination_name: Optional[str] = None
    journey_plan: Optional[dict] = None
    current_segment_index: int = 0
    mode: str = "online"

class LocationLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    session_id: Optional[str] = None
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class LocationLogCreate(BaseModel):
    user_id: str
    session_id: Optional[str] = None
    latitude: float
    longitude: float
    accuracy: Optional[float] = None

class AlertHistory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    session_id: Optional[str] = None
    alert_type: str  # obstacle, emergency, warning
    message: str
    location: Optional[dict] = None
    priority: str = "medium"  # low, medium, high, critical
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class AlertHistoryCreate(BaseModel):
    user_id: str
    session_id: Optional[str] = None
    alert_type: str
    message: str
    location: Optional[dict] = None
    priority: str = "medium"

class ObstacleDetectionRequest(BaseModel):
    image_base64: str
    user_id: str
    session_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class ObstacleDetectionResponse(BaseModel):
    obstacles: List[dict]
    safe_direction: Optional[str] = None
    warning_level: str  # safe, caution, danger, critical
    audio_message: str

class EmergencyAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    location: Optional[dict] = None
    message: str
    sms_mode_used: str = "composer"  # composer, direct, failed
    contacts_attempted: List[str] = []
    contacts_notified: List[str] = []
    notify_errors: List[str] = []
    status: str = "active"  # active, resolved
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None

class EmergencyAlertCreate(BaseModel):
    user_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    message: Optional[str] = "Emergency assistance needed"
    sms_mode_used: Optional[str] = "composer"
    contacts_attempted: Optional[List[str]] = []
    contacts_notified: Optional[List[str]] = []
    notify_errors: Optional[List[str]] = []
    sms_mode_used: Optional[str] = "composer"
    contacts_attempted: Optional[List[str]] = []
    contacts_notified: Optional[List[str]] = []
    notify_errors: Optional[List[str]] = []

# ==================== USER ROUTES ====================

@api_router.post("/users", response_model=User)
async def create_user(user: UserCreate):
    user_dict = user.model_dump()
    user_obj = User(**user_dict)
    await db.users.insert_one(user_obj.model_dump())
    return user_obj

@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**user)

# ==================== EMERGENCY CONTACT ROUTES ====================

@api_router.post("/emergency-contacts", response_model=EmergencyContact)
async def create_emergency_contact(contact: EmergencyContactCreate):
    contact_dict = contact.model_dump()
    contact_obj = EmergencyContact(**contact_dict)
    await db.emergency_contacts.insert_one(contact_obj.model_dump())
    return contact_obj

@api_router.get("/emergency-contacts/{user_id}", response_model=List[EmergencyContact])
async def get_emergency_contacts(user_id: str):
    contacts = await db.emergency_contacts.find({"user_id": user_id}).sort("priority", 1).to_list(100)
    return [EmergencyContact(**contact) for contact in contacts]

@api_router.delete("/emergency-contacts/{contact_id}")
async def delete_emergency_contact(contact_id: str):
    result = await db.emergency_contacts.delete_one({"id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted successfully"}

# ==================== NAVIGATION SESSION ROUTES ====================

@api_router.post("/navigation-sessions", response_model=NavigationSession)
async def create_navigation_session(session: NavigationSessionCreate):
    session_dict = session.model_dump()
    session_obj = NavigationSession(**session_dict)
    await db.navigation_sessions.insert_one(session_obj.model_dump())
    return session_obj

@api_router.get("/navigation-sessions/{session_id}", response_model=NavigationSession)
async def get_navigation_session(session_id: str):
    session = await db.navigation_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return NavigationSession(**session)

@api_router.patch("/navigation-sessions/{session_id}")
async def update_navigation_session(session_id: str, status: str = None, current_segment_index: int = None):
    update_data = {}
    
    if status is not None:
        update_data["status"] = status
        if status in ["completed", "cancelled"]:
            update_data["completed_at"] = datetime.utcnow()
    
    if current_segment_index is not None:
        update_data["current_segment_index"] = current_segment_index
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await db.navigation_sessions.update_one(
        {"id": session_id},
        {"$set": update_data}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session updated successfully", "updated_fields": update_data}

@api_router.get("/navigation-sessions/user/{user_id}", response_model=List[NavigationSession])
async def get_user_navigation_sessions(user_id: str, limit: int = 20):
    sessions = await db.navigation_sessions.find(
        {"user_id": user_id}
    ).sort("started_at", -1).limit(limit).to_list(limit)
    return [NavigationSession(**session) for session in sessions]

# ==================== LOCATION LOG ROUTES ====================

@api_router.post("/location-logs", response_model=LocationLog)
async def create_location_log(log: LocationLogCreate):
    log_dict = log.model_dump()
    log_obj = LocationLog(**log_dict)
    await db.location_logs.insert_one(log_obj.model_dump())
    return log_obj

@api_router.post("/location-logs/batch")
async def create_location_logs_batch(logs: List[LocationLogCreate]):
    log_objects = [LocationLog(**log.model_dump()) for log in logs]
    log_dicts = [log.model_dump() for log in log_objects]
    await db.location_logs.insert_many(log_dicts)
    return {"message": f"Created {len(log_objects)} location logs"}

# ==================== ALERT HISTORY ROUTES ====================

@api_router.post("/alerts", response_model=AlertHistory)
async def create_alert(alert: AlertHistoryCreate):
    alert_dict = alert.model_dump()
    alert_obj = AlertHistory(**alert_dict)
    await db.alert_history.insert_one(alert_obj.model_dump())
    return alert_obj

@api_router.get("/alerts/user/{user_id}", response_model=List[AlertHistory])
async def get_user_alerts(user_id: str, limit: int = 50):
    alerts = await db.alert_history.find(
        {"user_id": user_id}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    return [AlertHistory(**alert) for alert in alerts]

# ==================== AI VISION OBSTACLE DETECTION ====================

def get_yolo_model():
    global _yolo_model
    if not YOLO_AVAILABLE:
        return None

    if _yolo_model is not None:
        return _yolo_model

    with _yolo_lock:
        if _yolo_model is None:
            try:
                from ultralytics import YOLO as UltralyticsYOLO
                _yolo_model = UltralyticsYOLO(YOLO_MODEL_PATH)
            except Exception as exc:
                logger.warning(f"YOLO disabled: failed to load ultralytics model ({exc})")
                return None
    return _yolo_model


def decode_base64_image(image_base64: str):
    image_str = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
    image_bytes = base64.b64decode(image_str)
    np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)


def direction_from_x_center(x_center: float, frame_width: int) -> str:
    ratio = x_center / max(frame_width, 1)
    if ratio < 0.25:
        return "left"
    if ratio < 0.42:
        return "front-left"
    if ratio <= 0.58:
        return "front"
    if ratio <= 0.75:
        return "front-right"
    return "right"


def distance_from_box_area(box_area: float, frame_area: float) -> str:
    ratio = box_area / max(frame_area, 1.0)
    if ratio >= 0.24:
        return "immediate"
    if ratio >= 0.08:
        return "near"
    return "far"


def summarize_path_safety(obstacles: List[dict]):
    if not obstacles:
        return "forward", "safe"

    blocked = {"left": 0, "forward": 0, "right": 0}
    immediate_front = False

    for obstacle in obstacles:
        direction = obstacle.get("direction", "front")
        distance = obstacle.get("distance", "far")

        if direction in ["left", "front-left"]:
            blocked["left"] += 2 if distance == "immediate" else 1
        elif direction in ["right", "front-right"]:
            blocked["right"] += 2 if distance == "immediate" else 1
        else:
            blocked["forward"] += 2 if distance == "immediate" else 1
            if distance == "immediate":
                immediate_front = True

    if immediate_front and blocked["left"] > 0 and blocked["right"] > 0:
        safe_direction = "stop"
    else:
        safe_direction = min(blocked, key=blocked.get)

    if any(o.get("distance") == "immediate" for o in obstacles):
        warning_level = "danger" if safe_direction != "stop" else "critical"
    elif len(obstacles) >= 3:
        warning_level = "caution"
    else:
        warning_level = "safe"

    return safe_direction, warning_level


async def run_blocking(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: func(*args, **kwargs))


MOBILITY_RELEVANT_CLASSES = {
    "person", "bicycle", "car", "motorcycle", "bus", "truck", "train",
    "traffic light", "stop sign", "bench", "dog", "cat", "chair", "potted plant"
}

@api_router.post("/detect-obstacles", response_model=ObstacleDetectionResponse)
async def detect_obstacles(request: ObstacleDetectionRequest):
    """
    Production-grade obstacle detection with temporal consistency.
    
    Uses robust pipeline for:
    - Frame-to-frame object tracking
    - Confidence smoothing
    - Motion classification
    - Stable risk decision making with hysteresis
    - Reliable alert escalation
    """
    try:
        if not YOLO_AVAILABLE:
            # Fallback when YOLO unavailable
            message, risk = FailSafeManager.get_fallback_response("model_unavailable")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="forward",
                warning_level=risk.value,
                audio_message=message
            )

        # Decode image
        frame = decode_base64_image(request.image_base64)
        if frame is None:
            message, risk = FailSafeManager.get_fallback_response("image_invalid")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="stop",
                warning_level=risk.value,
                audio_message=message
            )

        # Load YOLO model
        model = get_yolo_model()
        if model is None:
            message, risk = FailSafeManager.get_fallback_response("model_unavailable")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="forward",
                warning_level=risk.value,
                audio_message=message
            )

        # Run inference asynchronously
        try:
            yolo_results = await asyncio.wait_for(
                run_blocking(
                    model.predict,
                    frame,
                    conf=YOLO_CONF_THRESHOLD,
                    verbose=False
                ),
                timeout=5.0  # 5 second timeout
            )
        except asyncio.TimeoutError:
            message, risk = FailSafeManager.get_fallback_response("inference_timeout")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="forward",
                warning_level=risk.value,
                audio_message=message
            )

        # Parse YOLO results
        result_obj = yolo_results[0]
        class_names = result_obj.names
        frame_height, frame_width = frame.shape[:2]
        frame_area = float(frame_width * frame_height)

        # Convert YOLO detections to RawDetection objects
        raw_detections = []
        if result_obj.boxes is not None:
            for box in result_obj.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cls_id = int(box.cls[0].item())
                confidence = float(box.conf[0].item())
                class_name = class_names.get(cls_id, str(cls_id))

                # Filter mobility-relevant classes only
                if class_name not in MOBILITY_RELEVANT_CLASSES:
                    continue

                # Normalize coordinates to 0-1
                bbox = BoundingBox(
                    x1=x1 / frame_width,
                    y1=y1 / frame_height,
                    x2=x2 / frame_width,
                    y2=y2 / frame_height
                )

                raw_detections.append(RawDetection(
                    class_id=cls_id,
                    class_name=class_name,
                    confidence=confidence,
                    bbox=bbox,
                    frame_width=frame_width,
                    frame_height=frame_height
                ))

        # Get session-specific pipeline
        session_id = request.session_id or f"session_{request.user_id}"
        pipeline = get_session_pipeline(session_id)

        # Process frame through robust pipeline
        detection_result = pipeline.process_frame(
            raw_detections=raw_detections,
            frame_width=frame_width,
            frame_height=frame_height
        )

        # Convert tracked objects to obstacle list format
        obstacles = []
        for obj in detection_result.tracked_objects:
            if not obj.is_persistent:
                continue  # Only report persistent objects

            bbox = obj.bbox_history[-1]
            area_ratio = bbox.area / (frame_width * frame_height)

            # Distance classification
            if area_ratio >= 0.24:
                distance = "immediate"
            elif area_ratio >= 0.08:
                distance = "near"
            else:
                distance = "far"

            # Direction classification
            ratio = bbox.center[0]
            if ratio < 0.25:
                direction = "left"
            elif ratio < 0.42:
                direction = "front-left"
            elif ratio <= 0.58:
                direction = "front"
            elif ratio <= 0.75:
                direction = "front-right"
            else:
                direction = "right"

            obstacles.append({
                "type": obj.class_name,
                "distance": distance,
                "direction": direction,
                "confidence": round(obj.smoothed_confidence, 3),
                "moving": obj.motion_state.name.lower(),
                "persistence_frames": obj.visibility_streak,
                "object_id": obj.object_id  # For debugging
            })

        # Log critical alert if triggered
        if detection_result.alert_triggered and detection_result.risk_level in [RiskLevel.DANGER, RiskLevel.CRITICAL]:
            alert = AlertHistoryCreate(
                user_id=request.user_id,
                session_id=session_id,
                alert_type="obstacle",
                message=detection_result.audio_message,
                location={"latitude": request.latitude, "longitude": request.longitude} if request.latitude else None,
                priority=detection_result.risk_level.value
            )
            await create_alert(alert)

        # Add telemetry to response
        response = ObstacleDetectionResponse(
            obstacles=obstacles,
            safe_direction=detection_result.safe_direction,
            warning_level=detection_result.risk_level.value,
            audio_message=detection_result.audio_message
        )

        # Log debug info (optional, commented for production)
        logger.debug(f"Frame {detection_result.frame_index}: {detection_result.debug_info}")

        return response

    except Exception as e:
        logger.error(f"Obstacle detection pipeline error: {str(e)}", exc_info=True)
        # Fail-safe: return conservative response
        message, risk = FailSafeManager.get_fallback_response("unknown_error")
        return ObstacleDetectionResponse(
            obstacles=[],
            safe_direction="stop",
            warning_level=risk.value,
            audio_message=message
        )


# ==================== PIPELINE MANAGEMENT ====================

@api_router.get("/detection-pipeline/status/{session_id}")
async def get_pipeline_status(session_id: str):
    """Get pipeline status and debug info for session"""
    pipeline = get_session_pipeline(session_id)
    
    return {
        "session_id": session_id,
        "frame_count": pipeline.frame_index,
        "active_objects": len(pipeline.tracker.tracked_objects),
        "current_risk": pipeline.risk_engine.current_risk.value,
        "frame_history_size": len(pipeline.frame_history),
        "status": "active"
    }


@api_router.post("/detection-pipeline/clear/{session_id}")
async def clear_pipeline(session_id: str):
    """Clear pipeline state for session (call when navigation ends)"""
    clear_session_pipeline(session_id)
    return {"message": f"Pipeline cleared for session {session_id}"}


@api_router.get("/detection-pipeline/debug/{session_id}")
async def get_pipeline_debug(session_id: str):
    """Get detailed debug information from latest frame"""
    pipeline = get_session_pipeline(session_id)
    
    if not pipeline.frame_history:
        return {"message": "No frames processed yet"}
    
    latest_frame = pipeline.frame_history[-1]
    
    return {
        "frame_index": latest_frame.frame_index,
        "timestamp": latest_frame.timestamp,
        "debug_info": latest_frame.debug_info,
        "risk_level": latest_frame.risk_level.value,
        "safe_direction": latest_frame.safe_direction,
        "alert_triggered": latest_frame.alert_triggered,
        "alert_reason": latest_frame.alert_reason.value if latest_frame.alert_reason else None,
        "audio_message": latest_frame.audio_message
    }


def generate_audio_message(result: dict) -> str:
    """Generate clear audio message for user"""
    warning_level = result.get("warning_level", "safe")
    obstacles = result.get("obstacles", [])
    safe_direction = result.get("safe_direction", "forward")
    primary_obstacle = obstacles[0]["type"] if obstacles else "obstacle"
    turn_hint = {
        "left": "Turn left slowly.",
        "right": "Turn right slowly.",
        "forward": "Continue forward carefully.",
        "stop": "Stop and reassess your path."
    }.get(safe_direction, f"Move {safe_direction} carefully.")
    
    if warning_level == "critical":
        return f"Stop now. Critical risk ahead with {primary_obstacle}. {turn_hint}"
    elif warning_level == "danger":
        urgent_obstacles = [o for o in obstacles if o.get("distance") == "immediate"]
        if urgent_obstacles:
            obstacle_types = ", ".join([o["type"] for o in urgent_obstacles[:2]])
            return f"Warning. {obstacle_types} immediately ahead. {turn_hint}"
        return f"Danger ahead. {turn_hint}"
    elif warning_level == "caution":
        if obstacles:
            obstacle_types = ", ".join([o["type"] for o in obstacles[:2]])
            return f"Caution. Detected {obstacle_types}. {turn_hint}"
        return f"Proceed with caution. {turn_hint}"
    else:
        return "Path looks clear. Continue forward."

# ==================== EMERGENCY ALERT ROUTES ====================

@api_router.post("/emergency-alert", response_model=EmergencyAlert)
async def trigger_emergency_alert(alert: EmergencyAlertCreate):
    # Get user's emergency contacts
    contacts = await get_emergency_contacts(alert.user_id)

    # Build location dict if available
    location = None
    if alert.latitude is not None and alert.longitude is not None:
        location = {"latitude": alert.latitude, "longitude": alert.longitude}
    
    # Build default contact lists from backend if not provided
    fallback_contacts = [c.phone for c in contacts]
    contacts_attempted = alert.contacts_attempted if alert.contacts_attempted else fallback_contacts
    contacts_notified = alert.contacts_notified if alert.contacts_notified else fallback_contacts
    
    alert_obj = EmergencyAlert(
        user_id=alert.user_id,
        location=location,
        message=alert.message,
        sms_mode_used=alert.sms_mode_used or "composer",
        contacts_attempted=contacts_attempted,
        contacts_notified=contacts_notified,
        notify_errors=alert.notify_errors or []
    )
    
    await db.emergency_alerts.insert_one(alert_obj.model_dump())
    
    # Log critical alert to history
    alert_log = AlertHistoryCreate(
        user_id=alert.user_id,
        alert_type="emergency",
        message=alert.message,
        location=location
    )
    await db.alert_history.insert_one(alert_log.model_dump())
    
    return alert_obj


@api_router.get("/emergency-alert/user/{user_id}", response_model=List[EmergencyAlert])
async def get_user_emergency_alerts(user_id: str):
    alerts = await db.emergency_alerts.find(
        {"user_id": user_id}
    ).sort("created_at", -1).to_list(50)
    return [EmergencyAlert(**alert) for alert in alerts]

# ==================== HEALTH CHECK ====================

@api_router.get("/")
async def root():
    return {"message": "AI Navigation System API", "status": "running"}

@api_router.get("/health")
async def health_check():
    try:
        # Check MongoDB connection
        await db.command("ping")
        return {
            "status": "healthy",
            "database": "connected",
            "vision_ai": "available" if YOLO_AVAILABLE else "unavailable"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
