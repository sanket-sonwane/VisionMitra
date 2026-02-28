from fastapi import FastAPI, APIRouter, HTTPException, File, UploadFile
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import time
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
    from scene_analyzer import SceneAnalyzer, SceneAnalysisResult, PathStatus, EnvironmentType
except ImportError:
    from .robust_detection_pipeline import (
        RobustDetectionPipeline,
        RawDetection,
        BoundingBox,
        RiskLevel,
        FailSafeManager
    )
    from .scene_analyzer import SceneAnalyzer, SceneAnalysisResult, PathStatus, EnvironmentType

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

# MongoDB connection (lazy init so server starts even when DNS/network is down)
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
_db_name = os.environ.get('DB_NAME', 'test_database')
_mongo_client = None
_mongo_db = None

def _get_mongo():
    global _mongo_client, _mongo_db
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
        _mongo_db = _mongo_client[_db_name]
    return _mongo_client, _mongo_db

class _LazyDB:
    """Proxy that delays MongoDB connection until first attribute access."""
    def __getattr__(self, name):
        _, real_db = _get_mongo()
        return getattr(real_db, name)

client_prop = property(lambda self: _get_mongo()[0])
db = _LazyDB()

# YOLOv8m model for maximum accuracy (upgraded from YOLOv8n)
YOLO_MODEL_PATH = os.environ.get('YOLO_MODEL_PATH', 'yolov8m.pt')
YOLO_CONF_THRESHOLD = float(os.environ.get('YOLO_CONF_THRESHOLD', '0.35'))
YOLO_IOU_THRESHOLD = float(os.environ.get('YOLO_IOU_THRESHOLD', '0.5'))
YOLO_IMAGE_SIZE = int(os.environ.get('YOLO_IMAGE_SIZE', '1280'))  # Larger size for small object detection
_yolo_model = None
_yolo_lock = Lock()
_last_inference_time = 0.0
_min_inference_interval = 0.5  # 500ms minimum interval for performance safeguard
_last_detection_response = None  # Cached response for throttle skips

# Scene analyzer singleton (per-session, but one global for stateless use)
_scene_analyzers: Dict[str, SceneAnalyzer] = {}
def get_scene_analyzer(session_id: str) -> SceneAnalyzer:
    if session_id not in _scene_analyzers:
        _scene_analyzers[session_id] = SceneAnalyzer()
    return _scene_analyzers[session_id]

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
        if session_id in _scene_analyzers:
            del _scene_analyzers[session_id]
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
    detection_count: Optional[int] = None  # raw YOLO detections before filtering
    filtered_count: Optional[int] = None   # detections removed by filters
    frame_size: Optional[str] = None       # image dimensions processed
    # Scene analysis fields
    scene_type: Optional[str] = None       # environment type (indoor_room, outdoor_road, etc.)
    scene_description: Optional[str] = None  # human-readable scene description
    path_status: Optional[str] = None      # clear, blocked, wall_ahead, edge_nearby
    wall_ahead: Optional[bool] = None
    wall_distance: Optional[str] = None    # immediate, near, far, none
    ground_type: Optional[str] = None      # pavement, grass, tile, concrete
    road_edges: Optional[bool] = None
    navigation_guidance: Optional[str] = None  # detailed guidance from scene analysis

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
    """Singleton lazy loading of YOLOv8m model with automatic download."""
    global _yolo_model
    if not YOLO_AVAILABLE:
        logger.warning("YOLO unavailable: OpenCV or NumPy not installed")
        return None

    # Return cached model if already loaded
    if _yolo_model is not None:
        return _yolo_model

    # Thread-safe model loading
    with _yolo_lock:
        if _yolo_model is None:
            try:
                from ultralytics import YOLO as UltralyticsYOLO
                logger.info(f"Loading YOLOv8m model from {YOLO_MODEL_PATH}...")
                load_start = time.time()
                
                # Auto-download model if not present
                _yolo_model = UltralyticsYOLO(YOLO_MODEL_PATH)
                
                load_time = time.time() - load_start
                logger.info(f"YOLOv8m model loaded successfully in {load_time:.2f}s")
                logger.info(f"Model parameters: conf={YOLO_CONF_THRESHOLD}, iou={YOLO_IOU_THRESHOLD}, imgsz={YOLO_IMAGE_SIZE}")
                
            except Exception as exc:
                logger.error(f"Failed to load YOLOv8m model: {exc}", exc_info=True)
                return None
    return _yolo_model


def decode_base64_image(image_base64: str):
    """Decode base64 image with error handling and auto-downscale."""
    try:
        image_str = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
        image_bytes = base64.b64decode(image_str)
        logger.info(f"Decoded base64: {len(image_bytes)} bytes")
        np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        
        if frame is None or frame.size == 0:
            logger.error("Decoded image is empty or invalid")
            return None
        
        # Auto-downscale large phone camera images to max 1280px
        h, w = frame.shape[:2]
        max_dim = 1280
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
            logger.info(f"Downscaled image from {w}x{h} to {new_w}x{new_h}")
            
        return frame
    except Exception as e:
        logger.error(f"Failed to decode base64 image: {e}")
        return None


def preprocess_frame(frame):
    """
    Pre-processing pipeline for maximum accuracy in challenging conditions.
    
    Applies:
    1. CLAHE contrast enhancement (helps in low-light)
    2. Gaussian blur (reduces sensor noise)
    3. Aspect ratio preserving resize
    
    Args:
        frame: Input BGR image
    
    Returns:
        Preprocessed frame ready for inference
    """
    try:
        if frame is None or frame.size == 0:
            return None
        
        # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
        # Improves detection in low-light and high-contrast scenarios
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        frame = cv2.merge((l, a, b))
        frame = cv2.cvtColor(frame, cv2.COLOR_LAB2BGR)
        
        # Apply light Gaussian blur to reduce sensor noise
        frame = cv2.GaussianBlur(frame, (3, 3), 0)
        
        return frame
        
    except Exception as e:
        logger.error(f"Pre-processing failed: {e}")
        # Return original frame if preprocessing fails
        return frame


def direction_from_x_center(x_center: float, frame_width: int) -> str:
    """
    5-zone precision direction classification for accurate spatial guidance.
    
    Zones:
    - 0-20%: left
    - 20-40%: front-left  
    - 40-60%: front
    - 60-80%: front-right
    - 80-100%: right
    """
    ratio = x_center / max(frame_width, 1)
    if ratio < 0.20:
        return "left"
    elif ratio < 0.40:
        return "front-left"
    elif ratio <= 0.60:
        return "front"
    elif ratio <= 0.80:
        return "front-right"
    else:
        return "right"


def distance_from_box_area(box_area: float, frame_area: float, y2: float = None, frame_height: int = None) -> str:
    """
    Improved distance estimation using area ratio and vertical position.
    
    Heuristic:
    - Large area (>30%): immediate
    - Medium area (>12%): near
    - Small area: far
    - Additionally: boost to immediate if object bottom near frame bottom (>80%)
    
    This improves real-world accuracy for ground-level obstacles.
    """
    area_ratio = box_area / max(frame_area, 1.0)
    
    # Base distance from area
    if area_ratio > 0.30:
        distance = "immediate"
    elif area_ratio > 0.12:
        distance = "near"
    else:
        distance = "far"
    
    # Boost risk if object is near bottom of frame (ground-level obstacles)
    if y2 is not None and frame_height is not None:
        if y2 > frame_height * 0.8 and distance == "near":
            distance = "immediate"
    
    return distance


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


# ==================== COMBINED AUDIO MESSAGE BUILDER ====================

def build_combined_audio_message(
    detection_result,
    obstacles: List[dict],
    scene_result: Optional[SceneAnalysisResult],
) -> str:
    """
    Build a rich, context-aware audio message combining YOLO detections
    with scene analysis. Designed to guide a blind person like a sighted
    companion would - describing WHERE they are, WHAT is around them,
    and WHERE to go.

    Message structure:
    1. Scene context (first frame / when environment changes)
    2. Immediate hazards (wall, obstacles)
    3. Navigation direction
    """
    parts = []
    risk = detection_result.risk_level.value

    # Part 1: Scene context (environment awareness)
    if scene_result:
        env = scene_result.environment.value
        env_phrases = {
            "indoor_room": "You are indoors",
            "indoor_corridor": "You are in a hallway",
            "outdoor_road": "You are on a road",
            "outdoor_sidewalk": "You are on a sidewalk",
            "outdoor_open": "You are in an open outdoor area",
            "stairway": "Stairs detected ahead",
            "unknown": "",
        }
        env_phrase = env_phrases.get(env, "")

        # Add ground type for context
        gt = scene_result.ground_type
        ground_phrases = {
            "pavement": "on paved ground",
            "grass": "on grass",
            "tile": "on a tiled floor",
            "concrete": "on concrete",
            "blocked": "",
        }
        ground_phrase = ground_phrases.get(gt, "")

        if env_phrase:
            if ground_phrase:
                parts.append(f"{env_phrase}, {ground_phrase}")
            else:
                parts.append(env_phrase)

    # Part 2: Wall/surface warning (HIGHEST priority - YOLO cannot detect these)
    if scene_result and scene_result.wall_ahead:
        wd = scene_result.wall_distance_hint
        wdir = scene_result.wall_direction
        if wd == "immediate":
            if wdir == "center":
                parts.append("Wall directly in front of you, very close. Stop")
            elif wdir == "left":
                parts.append("Wall very close on your left")
            elif wdir == "right":
                parts.append("Wall very close on your right")
        elif wd == "near":
            parts.append("Wall or large surface ahead")
        # Suggest open direction
        open_dir = scene_result.path_direction
        if open_dir in ("left", "right") and wd in ("immediate", "near"):
            parts.append(f"Turn {open_dir}")

    # Part 3: Road edge / boundary warnings
    if scene_result and scene_result.path_status == PathStatus.EDGE_NEARBY:
        pd = scene_result.path_direction
        if pd == "left":
            parts.append("Road edge on your right. Move left")
        elif pd == "right":
            parts.append("Road edge on your left. Move right")
        else:
            parts.append("Road boundary nearby. Stay centered")

    # Part 4: YOLO object detections
    if obstacles:
        # Group by urgency
        immediate = [o for o in obstacles if o.get("distance") == "immediate"]
        near = [o for o in obstacles if o.get("distance") == "near"]

        if immediate:
            types = list(set(o["type"] for o in immediate))
            type_str = " and ".join(types[:2])
            dirs = list(set(o.get("direction", "ahead") for o in immediate))
            dir_str = dirs[0] if len(dirs) == 1 else "ahead"
            # Check if approaching
            approaching = [o for o in immediate if o.get("moving") == "approaching"]
            if approaching:
                parts.append(f"{type_str.capitalize()} approaching from {dir_str}")
            else:
                parts.append(f"{type_str.capitalize()} very close, {dir_str}")
        elif near:
            types = list(set(o["type"] for o in near))
            type_str = " and ".join(types[:2])
            parts.append(f"{type_str.capitalize()} nearby")

    # Part 5: Navigation direction
    if scene_result and not scene_result.wall_ahead and not obstacles:
        # No YOLO objects, no wall - use scene guidance
        if scene_result.path_status == PathStatus.CLEAR:
            road_dir = scene_result.road_direction_hint
            if scene_result.road_edges_detected:
                if road_dir == "curves_left":
                    parts.append("Path clear. Road curves left ahead")
                elif road_dir == "curves_right":
                    parts.append("Path clear. Road curves right ahead")
                else:
                    parts.append("Path clear. Continue straight")
            else:
                parts.append("Path looks clear ahead. Continue forward")
        elif scene_result.path_status == PathStatus.PARTIALLY_BLOCKED:
            pd = scene_result.path_direction
            if pd in ("left", "right"):
                parts.append(f"Partial obstruction. Move {pd}")
            else:
                parts.append("Partial obstruction ahead. Proceed slowly")
        elif scene_result.path_status == PathStatus.BLOCKED:
            parts.append("Path appears blocked. Stop and reassess")
        elif scene_result.path_status == PathStatus.NO_PATH:
            parts.append("No clear path visible. Stop")
    elif not obstacles and not scene_result:
        # Fallback: no scene analysis, no objects (original behavior)
        if risk == "safe":
            parts.append("Path appears clear. Continue forward carefully")

    # Part 6: Direction hint for danger/critical with objects
    if obstacles and risk in ("danger", "critical"):
        safe_dir = detection_result.safe_direction
        dir_hints = {
            "left": "Move left",
            "right": "Move right",
            "forward": "Proceed carefully forward",
            "front-left": "Move to your front left",
            "front-right": "Move to your front right",
            "stop": "Stop immediately. Do not move",
        }
        hint = dir_hints.get(safe_dir, f"Move {safe_dir}")
        parts.append(hint)
    elif obstacles and risk == "caution":
        parts.append("Walk carefully")

    # Assemble final message
    if not parts:
        # Ultimate fallback
        if risk == "safe":
            return "Continue forward carefully."
        elif risk == "caution":
            return "Proceed with caution."
        elif risk == "danger":
            return "Danger detected. Be very careful."
        else:
            return "Stop. Critical hazard detected."

    return ". ".join(parts) + "."


# Mobility-critical classes for visually impaired navigation
# Only these classes are relevant for safe navigation
MOBILITY_CLASSES = {
    "person",
    "car",
    "bus",
    "truck",
    "motorcycle",
    "bicycle",
    "bench",
    "chair",
    "dog",
    "cat",
    "traffic light",
    "stop sign"
}

@api_router.post("/detect-obstacles", response_model=ObstacleDetectionResponse)
async def detect_obstacles(request: ObstacleDetectionRequest):
    """
    Production-grade obstacle detection with YOLOv8m - Maximum Accuracy Mode.
    
    Features:
    - YOLOv8m model (upgraded from YOLOv8n) for superior detection
    - Pre-processing pipeline (CLAHE + Gaussian blur) for low-light accuracy
    - track() method with persist=True for stable object IDs
    - imgsz=1280 for small object detection
    - Temporal tracking with confidence smoothing
    - Motion classification (approaching/receding/stationary/sideways)
    - Stable risk decision making with hysteresis
    - 5-zone direction precision
    - Enhanced distance estimation with vertical position
    - Comprehensive edge case handling
    - Performance safeguards (500ms minimum interval)
    
    Safety and accuracy are highest priority. Latency is secondary.
    """
    global _last_inference_time, _last_detection_response
    
    try:
        # Performance safeguard: Limit processing frequency to 500ms minimum
        current_time = time.time()
        time_since_last = current_time - _last_inference_time
        if time_since_last < _min_inference_interval and _last_detection_response is not None:
            logger.debug(f"Throttled - returning cached response ({time_since_last:.3f}s < {_min_inference_interval}s)")
            return _last_detection_response
        
        # Edge case: Check if YOLO is available
        if not YOLO_AVAILABLE:
            message, risk = FailSafeManager.get_fallback_response("model_unavailable")
            logger.warning("YOLO unavailable - returning fallback response")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="forward",
                warning_level=risk.value,
                audio_message=message
            )

        # Edge case: Decode image with validation
        frame = decode_base64_image(request.image_base64)
        if frame is None or frame.size == 0:
            message, risk = FailSafeManager.get_fallback_response("image_invalid")
            logger.error("Failed to decode image - invalid or empty")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="stop",
                warning_level=risk.value,
                audio_message=message
            )

        # Get original dimensions before preprocessing
        orig_height, orig_width = frame.shape[:2]
        logger.info(f"Processing frame: {orig_width}x{orig_height}")

        # Apply pre-processing pipeline for maximum accuracy
        frame_preprocessed = preprocess_frame(frame)
        if frame_preprocessed is None:
            logger.warning("Preprocessing failed, using original frame")
            frame_preprocessed = frame

        # Load YOLOv8m model (singleton)
        model = get_yolo_model()
        if model is None:
            message, risk = FailSafeManager.get_fallback_response("model_unavailable")
            logger.error("Failed to load YOLO model")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="forward",
                warning_level=risk.value,
                audio_message=message
            )

        # Run inference with MAXIMUM ACCURACY settings
        inference_start = time.time()
        try:
            yolo_results = await asyncio.wait_for(
                run_blocking(
                    model.track,  # Use track() for stable object IDs
                    frame_preprocessed,
                    persist=True,  # Maintain tracking across frames
                    imgsz=YOLO_IMAGE_SIZE,  # 1280 for small object detection
                    conf=YOLO_CONF_THRESHOLD,  # 0.35 confidence threshold
                    iou=YOLO_IOU_THRESHOLD,  # 0.5 IoU for NMS
                    agnostic_nms=False,  # Class-aware NMS
                    retina_masks=True,  # More precise segmentation
                    verbose=False
                ),
                timeout=10.0  # 10 second timeout for safety
            )
            inference_time = time.time() - inference_start
            _last_inference_time = time.time()
            logger.info(f"Inference completed in {inference_time:.3f}s")
            
        except asyncio.TimeoutError:
            message, risk = FailSafeManager.get_fallback_response("inference_timeout")
            logger.error("Inference timeout - taking too long")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="forward",
                warning_level=risk.value,
                audio_message=message
            )
        except Exception as e:
            logger.error(f"Inference error: {e}", exc_info=True)
            message, risk = FailSafeManager.get_fallback_response("unknown_error")
            return ObstacleDetectionResponse(
                obstacles=[],
                safe_direction="stop",
                warning_level=risk.value,
                audio_message=message
            )

        # Parse YOLO results
        result_obj = yolo_results[0]
        class_names = result_obj.names
        frame_height, frame_width = orig_height, orig_width
        frame_area = float(frame_width * frame_height)

        # Convert YOLOv8m detections to RawDetection objects with enhanced filtering
        raw_detections = []
        detection_count = 0
        filtered_count = 0
        
        if result_obj.boxes is not None:
            for box in result_obj.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cls_id = int(box.cls[0].item())
                confidence = float(box.conf[0].item())
                class_name = class_names.get(cls_id, str(cls_id))
                
                detection_count += 1

                # Filter 1: Only mobility-critical classes
                if class_name not in MOBILITY_CLASSES:
                    filtered_count += 1
                    continue
                
                # Filter 2: Minimum confidence (safety threshold) 
                if confidence < YOLO_CONF_THRESHOLD:
                    filtered_count += 1
                    continue
                
                # Filter 3: Minimum area (prevent noise detections)
                box_area = (x2 - x1) * (y2 - y1)
                if box_area < 0.001 * frame_area:
                    filtered_count += 1
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
        
        logger.info(f"Detections: {detection_count} total, {filtered_count} filtered, {len(raw_detections)} passed")

        # Get session-specific pipeline (thread-safe per-session tracking)
        session_id = request.session_id or f"session_{request.user_id}"
        pipeline = get_session_pipeline(session_id)

        # Process frame through robust temporal pipeline
        detection_result = pipeline.process_frame(
            raw_detections=raw_detections,
            frame_width=frame_width,
            frame_height=frame_height
        )

        # Convert tracked objects to obstacle list format with enhanced metrics
        obstacles = []
        for obj in detection_result.tracked_objects:
            if not obj.is_persistent:
                continue  # Only report persistent (stable) objects

            bbox = obj.bbox_history[-1]
            box_center_x = bbox.center[0] * frame_width
            box_center_y = bbox.center[1] * frame_height
            box_area = bbox.area * frame_area
            y2 = bbox.y2 * frame_height

            # Enhanced distance classification with vertical position boost
            distance = distance_from_box_area(box_area, frame_area, y2, frame_height)

            # 5-zone precision direction classification
            direction = direction_from_x_center(box_center_x, frame_width)

            obstacles.append({
                "type": obj.class_name,
                "distance": distance,
                "direction": direction,
                "confidence": round(obj.smoothed_confidence, 3),
                "moving": obj.motion_state.value,
                "persistence_frames": obj.visibility_streak,
                "object_id": obj.object_id,  # Tracking ID for debugging
                "center": [round(box_center_x, 1), round(box_center_y, 1)],
                "area": round(box_area, 1)
            })

        # ==================== SCENE ANALYSIS (OpenCV) ====================
        # Run scene analysis on original frame for environment awareness
        scene_analyzer = get_scene_analyzer(session_id)
        try:
            scene_result = await run_blocking(scene_analyzer.analyze, frame)
            logger.info(
                f"Scene: env={scene_result.environment.value}, "
                f"path={scene_result.path_status.value}, "
                f"wall={scene_result.wall_ahead}({scene_result.wall_distance_hint}), "
                f"ground={scene_result.ground_type}, "
                f"analysis={scene_result.analysis_time_ms:.0f}ms"
            )
        except Exception as scene_err:
            logger.warning(f"Scene analysis failed: {scene_err}")
            scene_result = None

        # ==================== COMBINED AUDIO MESSAGE ====================
        # Merge YOLO object detection + scene analysis into one rich message
        combined_audio = build_combined_audio_message(
            detection_result, obstacles, scene_result
        )

        # Override warning level if scene says wall ahead but YOLO says safe
        final_warning = detection_result.risk_level.value
        final_direction = detection_result.safe_direction
        if scene_result:
            if scene_result.wall_ahead and scene_result.wall_distance_hint == "immediate":
                if final_warning == "safe":
                    final_warning = "danger"
                elif final_warning == "caution":
                    final_warning = "danger"
                if final_direction == "forward":
                    open_dir = scene_result.path_direction
                    if open_dir in ("left", "right"):
                        final_direction = open_dir
                    else:
                        final_direction = "stop"
            elif scene_result.wall_ahead and scene_result.wall_distance_hint == "near":
                if final_warning == "safe":
                    final_warning = "caution"
            elif scene_result.path_status == PathStatus.BLOCKED:
                if final_warning == "safe":
                    final_warning = "caution"
            elif scene_result.path_status == PathStatus.EDGE_NEARBY:
                if final_warning == "safe":
                    final_warning = "caution"

        # Log critical/danger alerts to database
        if detection_result.alert_triggered and detection_result.risk_level in [RiskLevel.DANGER, RiskLevel.CRITICAL]:
            alert = AlertHistoryCreate(
                user_id=request.user_id,
                session_id=session_id,
                alert_type="obstacle",
                message=combined_audio,
                location={"latitude": request.latitude, "longitude": request.longitude} if request.latitude else None,
                priority=detection_result.risk_level.value
            )
            await create_alert(alert)
            logger.warning(f"Critical alert logged: {detection_result.risk_level.value}")

        # Build response with scene data
        response = ObstacleDetectionResponse(
            obstacles=obstacles,
            safe_direction=final_direction,
            warning_level=final_warning,
            audio_message=combined_audio,
            detection_count=detection_count,
            filtered_count=filtered_count,
            frame_size=f"{orig_width}x{orig_height}",
            scene_type=scene_result.environment.value if scene_result else None,
            scene_description=scene_result.scene_description if scene_result else None,
            path_status=scene_result.path_status.value if scene_result else None,
            wall_ahead=scene_result.wall_ahead if scene_result else None,
            wall_distance=scene_result.wall_distance_hint if scene_result else None,
            ground_type=scene_result.ground_type if scene_result else None,
            road_edges=scene_result.road_edges_detected if scene_result else None,
            navigation_guidance=scene_result.navigation_guidance if scene_result else None,
        )

        # Cache response for throttle
        _last_detection_response = response

        # Enhanced logging for production monitoring
        logger.info(
            f"Detection complete - Frame: {detection_result.frame_index}, "
            f"Risk: {final_warning}, "
            f"Objects: {len(obstacles)}, "
            f"Alert: {detection_result.alert_triggered}, "
            f"Direction: {final_direction}, "
            f"Scene: {scene_result.environment.value if scene_result else 'N/A'}"
        )
        logger.debug(f"Debug info: {detection_result.debug_info}")

        return response

    except Exception as e:
        logger.error(f"Obstacle detection pipeline error: {str(e)}", exc_info=True)
        # Fail-safe: Never crash, always provide conservative response
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
    if _mongo_client is not None:
        _mongo_client.close()
