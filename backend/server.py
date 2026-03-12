from fastapi import FastAPI, APIRouter, HTTPException, File, UploadFile
from fastapi.responses import ORJSONResponse
from starlette.middleware.gzip import GZipMiddleware
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

# MongoDB connection (lazy - don't block startup on DNS failures)
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
try:
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)
    db = client[os.environ.get('DB_NAME', 'test_database')]
except Exception as _mongo_err:
    logging.warning(f"MongoDB connection failed ({_mongo_err}), falling back to localhost")
    client = AsyncIOMotorClient('mongodb://localhost:27017', serverSelectionTimeoutMS=5000)
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

# Logging: WARNING by default for performance; set LOG_LEVEL=DEBUG for debug branch
_log_level = os.environ.get('LOG_LEVEL', 'WARNING').upper()
logging.basicConfig(
    level=getattr(logging, _log_level, logging.WARNING),
    format='%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] %(message)s'
)
logger = logging.getLogger(__name__)
logger.setLevel(getattr(logging, _log_level, logging.WARNING))

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
    include_debug_image: bool = False   # opt-in: send back annotated image
    include_debug_info: bool = False    # opt-in: send back full debug telemetry

class ObstacleDetectionResponse(BaseModel):
    obstacles: List[dict]
    safe_direction: Optional[str] = None
    warning_level: str  # safe, caution, danger, critical
    audio_message: str
    detection_coords: Optional[List[dict]] = None  # lightweight bbox coords for client-side drawing
    debug_annotated_image: Optional[str] = None  # base64 annotated image with boxes (opt-in)
    debug_info: Optional[dict] = None  # detailed debug telemetry (opt-in)

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

# ==================== USER ROUTES ====================

@api_router.post("/users", response_model=User)
async def create_user(user: UserCreate):
    user_dict = user.model_dump()
    user_obj = User(**user_dict)
    try:
        await asyncio.wait_for(db.users.insert_one(user_obj.model_dump()), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB write failed for user: {e}")
    return user_obj

@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    try:
        user = await asyncio.wait_for(db.users.find_one({"id": user_id}), timeout=3.0)
        if user:
            return User(**user)
    except Exception as e:
        logger.warning(f"MongoDB read failed for user: {e}")
    raise HTTPException(status_code=404, detail="User not found")

# ==================== EMERGENCY CONTACT ROUTES ====================

# In-memory fallback when MongoDB is unavailable
_contacts_cache: Dict[str, List[dict]] = {}  # user_id -> [contact_dict]

def _cache_add_contact(contact_data: dict):
    uid = contact_data["user_id"]
    if uid not in _contacts_cache:
        _contacts_cache[uid] = []
    _contacts_cache[uid].append(contact_data)

def _cache_get_contacts(user_id: str) -> List[dict]:
    return sorted(_contacts_cache.get(user_id, []), key=lambda c: c.get("priority", 999))

def _cache_delete_contact(contact_id: str) -> bool:
    for uid, contacts in _contacts_cache.items():
        for i, c in enumerate(contacts):
            if c.get("id") == contact_id:
                contacts.pop(i)
                return True
    return False

@api_router.post("/emergency-contacts", response_model=EmergencyContact)
async def create_emergency_contact(contact: EmergencyContactCreate):
    contact_dict = contact.model_dump()
    contact_obj = EmergencyContact(**contact_dict)
    contact_data = contact_obj.model_dump()
    # Always store in memory
    _cache_add_contact(contact_data)
    # Try MongoDB with timeout
    try:
        await asyncio.wait_for(db.emergency_contacts.insert_one(contact_data), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB write failed for contact, using in-memory: {e}")
    return contact_obj

@api_router.get("/emergency-contacts/{user_id}", response_model=List[EmergencyContact])
async def get_emergency_contacts(user_id: str):
    # Try memory first, then MongoDB
    cached = _cache_get_contacts(user_id)
    if cached:
        return [EmergencyContact(**c) for c in cached]
    try:
        contacts = await asyncio.wait_for(
            db.emergency_contacts.find({"user_id": user_id}).sort("priority", 1).to_list(100),
            timeout=3.0
        )
        if contacts:
            # Populate cache from DB
            for c in contacts:
                _cache_add_contact(c)
            return [EmergencyContact(**contact) for contact in contacts]
    except Exception as e:
        logger.warning(f"MongoDB read failed for contacts: {e}")
    return []

@api_router.delete("/emergency-contacts/{contact_id}")
async def delete_emergency_contact(contact_id: str):
    # Always remove from memory
    found_in_cache = _cache_delete_contact(contact_id)
    # Try MongoDB
    try:
        result = await asyncio.wait_for(db.emergency_contacts.delete_one({"id": contact_id}), timeout=3.0)
        if result.deleted_count == 0 and not found_in_cache:
            raise HTTPException(status_code=404, detail="Contact not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"MongoDB delete failed for contact: {e}")
        if not found_in_cache:
            raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted successfully"}

# ==================== NAVIGATION SESSION ROUTES ====================

# In-memory fallback when MongoDB is unavailable
_nav_sessions_cache: Dict[str, dict] = {}

@api_router.post("/navigation-sessions", response_model=NavigationSession)
async def create_navigation_session(session: NavigationSessionCreate):
    session_dict = session.model_dump()
    session_obj = NavigationSession(**session_dict)
    session_data = session_obj.model_dump()
    try:
        await asyncio.wait_for(db.navigation_sessions.insert_one(session_data), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB write failed for nav session, using in-memory: {e}")
    # Always store in memory so navigation works regardless of DB
    _nav_sessions_cache[session_obj.id] = session_data
    return session_obj

@api_router.get("/navigation-sessions/{session_id}", response_model=NavigationSession)
async def get_navigation_session(session_id: str):
    # Check in-memory cache first
    if session_id in _nav_sessions_cache:
        return NavigationSession(**_nav_sessions_cache[session_id])
    try:
        session = await asyncio.wait_for(db.navigation_sessions.find_one({"id": session_id}), timeout=3.0)
        if session:
            return NavigationSession(**session)
    except Exception as e:
        logger.warning(f"MongoDB read failed for nav session: {e}")
    raise HTTPException(status_code=404, detail="Session not found")

@api_router.patch("/navigation-sessions/{session_id}")
async def update_navigation_session(session_id: str, status: str = None, current_segment_index: int = None):
    update_data = {}
    
    if status is not None:
        update_data["status"] = status
        if status in ["completed", "cancelled"]:
            update_data["completed_at"] = datetime.utcnow().isoformat()
    
    if current_segment_index is not None:
        update_data["current_segment_index"] = current_segment_index
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    # Update in-memory cache
    if session_id in _nav_sessions_cache:
        _nav_sessions_cache[session_id].update(update_data)
    
    # Try MongoDB (non-blocking)
    try:
        await asyncio.wait_for(
            db.navigation_sessions.update_one({"id": session_id}, {"$set": update_data}),
            timeout=3.0
        )
    except Exception as e:
        logger.warning(f"MongoDB update failed for nav session: {e}")
    
    return {"message": "Session updated successfully", "updated_fields": update_data}

@api_router.get("/navigation-sessions/user/{user_id}", response_model=List[NavigationSession])
async def get_user_navigation_sessions(user_id: str, limit: int = 20):
    # Combine in-memory and DB results
    sessions = []
    cached_ids = set()
    for sid, sdata in _nav_sessions_cache.items():
        if sdata.get("user_id") == user_id:
            sessions.append(NavigationSession(**sdata))
            cached_ids.add(sid)
    try:
        db_sessions = await asyncio.wait_for(
            db.navigation_sessions.find({"user_id": user_id}).sort("started_at", -1).limit(limit).to_list(limit),
            timeout=3.0
        )
        for s in db_sessions:
            if s.get("id") not in cached_ids:
                sessions.append(NavigationSession(**s))
    except Exception as e:
        logger.warning(f"MongoDB read failed for user sessions: {e}")
    sessions.sort(key=lambda x: x.started_at, reverse=True)
    return sessions[:limit]

# ==================== LOCATION LOG ROUTES ====================

@api_router.post("/location-logs", response_model=LocationLog)
async def create_location_log(log: LocationLogCreate):
    log_dict = log.model_dump()
    log_obj = LocationLog(**log_dict)
    try:
        await asyncio.wait_for(db.location_logs.insert_one(log_obj.model_dump()), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB write failed for location log: {e}")
    return log_obj

@api_router.post("/location-logs/batch")
async def create_location_logs_batch(logs: List[LocationLogCreate]):
    log_objects = [LocationLog(**log.model_dump()) for log in logs]
    log_dicts = [log.model_dump() for log in log_objects]
    try:
        await asyncio.wait_for(db.location_logs.insert_many(log_dicts), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB batch write failed for location logs: {e}")
    return {"message": f"Created {len(log_objects)} location logs"}

# ==================== ALERT HISTORY ROUTES ====================

@api_router.post("/alerts", response_model=AlertHistory)
async def create_alert(alert: AlertHistoryCreate):
    alert_dict = alert.model_dump()
    alert_obj = AlertHistory(**alert_dict)
    try:
        await asyncio.wait_for(db.alert_history.insert_one(alert_obj.model_dump()), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB write failed for alert: {e}")
    return alert_obj

@api_router.get("/alerts/user/{user_id}", response_model=List[AlertHistory])
async def get_user_alerts(user_id: str, limit: int = 50):
    try:
        alerts = await asyncio.wait_for(
            db.alert_history.find({"user_id": user_id}).sort("timestamp", -1).limit(limit).to_list(limit),
            timeout=3.0
        )
        return [AlertHistory(**alert) for alert in alerts]
    except Exception as e:
        logger.warning(f"MongoDB read failed for alerts: {e}")
        return []

# ==================== AI VISION OBSTACLE DETECTION ====================

def get_yolo_model():
    global _yolo_model
    logger.debug(f"[DEBUG-YOLO] get_yolo_model called. YOLO_AVAILABLE={YOLO_AVAILABLE}, model_loaded={_yolo_model is not None}")
    logger.debug(f"[DEBUG-YOLO] ENABLE_VISION_AI={ENABLE_VISION_AI}, CV2_AVAILABLE={CV2_AVAILABLE}, np_available={np is not None}")
    if not YOLO_AVAILABLE:
        logger.warning(f"[DEBUG-YOLO] YOLO not available! ENABLE_VISION_AI={ENABLE_VISION_AI}, CV2={CV2_AVAILABLE}, numpy={np is not None}")
        return None

    if _yolo_model is not None:
        logger.debug("[DEBUG-YOLO] Returning cached model")
        return _yolo_model

    with _yolo_lock:
        if _yolo_model is None:
            try:
                from ultralytics import YOLO as UltralyticsYOLO
                model_path = YOLO_MODEL_PATH
                logger.info(f"[DEBUG-YOLO] Loading model from: {model_path}")
                logger.info(f"[DEBUG-YOLO] Model file exists: {os.path.exists(model_path)}")
                _yolo_model = UltralyticsYOLO(model_path)
                logger.info(f"[DEBUG-YOLO] Model loaded successfully: {type(_yolo_model)}")
            except Exception as exc:
                logger.error(f"[DEBUG-YOLO] FAILED to load model: {exc}", exc_info=True)
                return None
    return _yolo_model


def decode_base64_image(image_base64: str):
    logger.debug(f"[DEBUG-DECODE] Input base64 length: {len(image_base64)}")
    logger.debug(f"[DEBUG-DECODE] Has data URI prefix: {',' in image_base64[:50]}")
    image_str = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
    logger.debug(f"[DEBUG-DECODE] Stripped base64 length: {len(image_str)}")
    try:
        image_bytes = base64.b64decode(image_str)
        logger.debug(f"[DEBUG-DECODE] Decoded bytes length: {len(image_bytes)}")
    except Exception as e:
        logger.error(f"[DEBUG-DECODE] base64 decode FAILED: {e}")
        return None
    np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
    logger.debug(f"[DEBUG-DECODE] numpy array shape: {np_arr.shape}, dtype: {np_arr.dtype}")
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if frame is None:
        logger.error("[DEBUG-DECODE] cv2.imdecode returned None! Image data may be corrupt.")
    else:
        logger.debug(f"[DEBUG-DECODE] Decoded frame: shape={frame.shape}, dtype={frame.dtype}")
    return frame


def draw_debug_boxes(frame, raw_detections, tracked_objects=None, risk_level=None, safe_direction=None):
    """
    Draw bounding boxes with labels and confidence scores on the frame.
    Returns annotated frame as base64 string.
    """
    if frame is None or not CV2_AVAILABLE:
        logger.warning("[DEBUG-DRAW] Cannot draw boxes: frame is None or cv2 unavailable")
        return None

    annotated = frame.copy()
    h, w = annotated.shape[:2]
    logger.debug(f"[DEBUG-DRAW] Drawing on frame {w}x{h}, {len(raw_detections)} raw detections")

    # Color map for different risk implications
    COLORS = {
        "immediate": (0, 0, 255),    # Red - very close
        "near": (0, 165, 255),       # Orange - nearby
        "far": (0, 255, 0),          # Green - far away
        "default": (255, 255, 0),    # Cyan - fallback
    }

    # Draw ALL raw YOLO detections (before any filtering)
    for i, det in enumerate(raw_detections):
        # Convert normalized coords back to pixel coords
        x1 = int(det.bbox.x1 * w)
        y1 = int(det.bbox.y1 * h)
        x2 = int(det.bbox.x2 * w)
        y2 = int(det.bbox.y2 * h)

        # Determine distance for color
        area_ratio = det.bbox.area
        if area_ratio >= 0.24:
            dist_label = "immediate"
        elif area_ratio >= 0.08:
            dist_label = "near"
        else:
            dist_label = "far"

        color = COLORS.get(dist_label, COLORS["default"])

        # Draw bounding box
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

        # Label with class name + confidence + distance
        label = f"{det.class_name} {det.confidence:.2f} [{dist_label}]"
        label_size, baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        # Background for text
        cv2.rectangle(annotated, (x1, y1 - label_size[1] - 6), (x1 + label_size[0], y1), color, -1)
        cv2.putText(annotated, label, (x1, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

        logger.debug(f"[DEBUG-DRAW] Box #{i}: {det.class_name} conf={det.confidence:.3f} "
                     f"bbox=({x1},{y1})-({x2},{y2}) area_ratio={area_ratio:.4f} dist={dist_label}")

    # Draw tracked object IDs if available
    if tracked_objects:
        for obj in tracked_objects:
            if obj.bbox_history:
                bbox = obj.bbox_history[-1]
                cx = int(bbox.center[0] * w)
                cy = int(bbox.center[1] * h)
                # Draw tracking ID and persistence info
                track_label = f"ID:{obj.object_id} v:{obj.visibility_streak} {'P' if obj.is_persistent else 'T'}"
                cv2.putText(annotated, track_label, (cx - 40, cy),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

    # Draw overall status overlay
    status_text = f"Risk: {risk_level or 'N/A'} | Safe Dir: {safe_direction or 'N/A'} | Detections: {len(raw_detections)}"
    cv2.rectangle(annotated, (0, 0), (w, 30), (0, 0, 0), -1)
    cv2.putText(annotated, status_text, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

    # Encode to base64
    _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
    annotated_b64 = base64.b64encode(buffer).decode('utf-8')
    logger.debug(f"[DEBUG-DRAW] Annotated image base64 length: {len(annotated_b64)}")
    return annotated_b64


# ==================== PROXIMITY / WALL DETECTION ====================

def analyze_scene_proximity(frame) -> dict:
    """
    Detect large uniform surfaces (walls, doors, pillars) via image analysis.
    YOLO cannot detect featureless surfaces — this fills that gap.
    
    Returns dict with:
      - is_obstructed: bool  (camera likely facing a large surface)
      - obstruction_confidence: float 0-1
      - reason: str
    """
    logger.debug(f"[DEBUG-PROXIMITY] Called with frame={frame is not None}, CV2={CV2_AVAILABLE}")
    if frame is None or not CV2_AVAILABLE:
        logger.warning("[DEBUG-PROXIMITY] Skipped: frame is None or cv2 unavailable")
        return {"is_obstructed": False, "obstruction_confidence": 0.0, "reason": "no_frame"}
    
    h, w = frame.shape[:2]
    logger.debug(f"[DEBUG-PROXIMITY] Frame size: {w}x{h}")
    result = {"is_obstructed": False, "obstruction_confidence": 0.0, "reason": "clear"}
    
    scores = []
    
    # --- 1. Edge density: walls/flat surfaces have very few edges ---
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.count_nonzero(edges)) / (h * w)
    logger.debug(f"[DEBUG-PROXIMITY] Edge density: {edge_density:.4f}")
    # Very low edge density → likely facing a flat surface
    if edge_density < 0.02:
        scores.append(0.7)
    elif edge_density < 0.04:
        scores.append(0.4)
    else:
        scores.append(0.0)
    
    # --- 2. Color uniformity in center region ---
    # A wall close-up will be very uniform in the center 60% of the frame
    cy1, cy2 = int(h * 0.2), int(h * 0.8)
    cx1, cx2 = int(w * 0.2), int(w * 0.8)
    center_region = frame[cy1:cy2, cx1:cx2]
    
    # Standard deviation of pixel values (low = uniform)
    std_dev = float(np.std(center_region))
    if std_dev < 15:
        scores.append(0.8)   # Very uniform — almost certainly a wall/surface
    elif std_dev < 25:
        scores.append(0.5)
    elif std_dev < 40:
        scores.append(0.2)
    else:
        scores.append(0.0)
    
    # --- 3. Laplacian variance (blur detection) ---
    # An object very close to the camera will be blurry
    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if laplacian_var < 50:
        scores.append(0.7)   # Very blurry — something very close
    elif laplacian_var < 150:
        scores.append(0.3)
    else:
        scores.append(0.0)
    
    # --- 4. Dominant color coverage ---
    # If one color covers >60% of pixels, likely a wall
    small = cv2.resize(center_region, (50, 50))
    pixels = small.reshape(-1, 3)
    # Quantize to reduce color space
    quantized = (pixels // 32) * 32
    unique, counts = np.unique(quantized, axis=0, return_counts=True)
    max_coverage = float(counts.max()) / len(pixels)
    if max_coverage > 0.6:
        scores.append(0.7)
    elif max_coverage > 0.4:
        scores.append(0.3)
    else:
        scores.append(0.0)
    
    # --- Aggregate score ---
    avg_score = sum(scores) / len(scores) if scores else 0.0
    logger.debug(f"[DEBUG-PROXIMITY] Scores breakdown: {scores}, average={avg_score:.3f}")
    
    if avg_score >= 0.45:
        result["is_obstructed"] = True
        result["obstruction_confidence"] = round(avg_score, 3)
        if edge_density < 0.02 and std_dev < 20:
            result["reason"] = "wall_or_flat_surface"
        elif laplacian_var < 50:
            result["reason"] = "very_close_object"
        else:
            result["reason"] = "large_uniform_surface"
    
    logger.info(
        f"[DEBUG-PROXIMITY] Result: obstructed={result['is_obstructed']}, conf={result['obstruction_confidence']}, "
        f"reason={result['reason']} | edge_density={edge_density:.4f}, std_dev={std_dev:.1f}, "
        f"laplacian={laplacian_var:.1f}, color_coverage={max_coverage:.2f}, score={avg_score:.3f}"
    )
    
    return result


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
    "traffic light", "stop sign", "bench", "dog", "cat", "chair", "potted plant",
    # Additional indoor/outdoor obstacles
    "couch", "bed", "dining table", "toilet", "tv", "laptop", "refrigerator",
    "oven", "sink", "microwave", "toaster", "fire hydrant", "parking meter",
    "backpack", "umbrella", "handbag", "suitcase", "sports ball", "skateboard",
    "surfboard", "bottle", "cup", "vase", "scissors", "book", "clock",
}

@api_router.post("/detect-obstacles")
async def detect_obstacles(request: ObstacleDetectionRequest):
    """
    Production-grade obstacle detection with temporal consistency.
    Opt-in debug: set include_debug_image / include_debug_info in request.
    """
    import time as _time
    _t0 = _time.time()
    debug_phases = {} if request.include_debug_info else None

    try:
        # ---- PHASE 1: Check YOLO availability ----
        logger.debug(f"[DETECT] request user_id={request.user_id} image_len={len(request.image_base64) if request.image_base64 else 0}")
        if debug_phases is not None:
            debug_phases['yolo_available'] = YOLO_AVAILABLE
            debug_phases['enable_vision_ai'] = ENABLE_VISION_AI
            debug_phases['cv2_available'] = CV2_AVAILABLE

        if not YOLO_AVAILABLE:
            logger.warning("[DETECT] YOLO NOT AVAILABLE")
            message, risk = FailSafeManager.get_fallback_response("model_unavailable")
            return ORJSONResponse({
                "obstacles": [],
                "safe_direction": "forward",
                "warning_level": risk.value,
                "audio_message": message,
                "debug_info": {"error": "YOLO_NOT_AVAILABLE"} if debug_phases is not None else None
            })

        # ---- PHASE 2: Decode image ----
        _t1 = _time.time()
        frame = decode_base64_image(request.image_base64)
        if debug_phases is not None:
            debug_phases['decode_time_ms'] = round((_time.time() - _t1) * 1000, 1)
        if frame is None:
            logger.warning("[DETECT] image decode failed")
            message, risk = FailSafeManager.get_fallback_response("image_invalid")
            return ORJSONResponse({
                "obstacles": [],
                "safe_direction": "stop",
                "warning_level": risk.value,
                "audio_message": message,
                "debug_info": {"error": "IMAGE_DECODE_FAILED"} if debug_phases is not None else None
            })
        if debug_phases is not None:
            debug_phases['frame_shape'] = list(frame.shape)

        # ---- PHASE 3: Resize for inference ----
        _t2 = _time.time()
        orig_h, orig_w = frame.shape[:2]
        MAX_DIM = 480
        if max(orig_h, orig_w) > MAX_DIM:
            scale = MAX_DIM / max(orig_h, orig_w)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            inference_frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        else:
            inference_frame = frame
        if debug_phases is not None:
            debug_phases['resize_time_ms'] = round((_time.time() - _t2) * 1000, 1)
            debug_phases['inference_frame_shape'] = list(inference_frame.shape)

        # ---- PHASE 4: Load YOLO model ----
        _t3 = _time.time()
        model = get_yolo_model()
        if debug_phases is not None:
            debug_phases['model_load_time_ms'] = round((_time.time() - _t3) * 1000, 1)
        if model is None:
            logger.warning("[DETECT] model is None")
            message, risk = FailSafeManager.get_fallback_response("model_unavailable")
            return ORJSONResponse({
                "obstacles": [],
                "safe_direction": "forward",
                "warning_level": risk.value,
                "audio_message": message,
                "debug_info": {"error": "MODEL_LOAD_FAILED"} if debug_phases is not None else None
            })

        # ---- PHASE 5: Run YOLO inference ----
        _t4 = _time.time()
        try:
            yolo_results = await asyncio.wait_for(
                run_blocking(
                    model.predict,
                    inference_frame,
                    conf=YOLO_CONF_THRESHOLD,
                    verbose=False,
                    imgsz=320
                ),
                timeout=8.0
            )
        except asyncio.TimeoutError:
            logger.warning("[DETECT] inference timeout (>8s)")
            if debug_phases is not None:
                debug_phases['inference_timeout'] = True
            message, risk = FailSafeManager.get_fallback_response("inference_timeout")
            return ORJSONResponse({
                "obstacles": [],
                "safe_direction": "forward",
                "warning_level": risk.value,
                "audio_message": message,
                "debug_info": debug_phases
            })
        if debug_phases is not None:
            debug_phases['inference_time_ms'] = round((_time.time() - _t4) * 1000, 1)

        # ---- PHASE 6: Parse YOLO results ----
        _t5 = _time.time()
        result_obj = yolo_results[0]
        class_names = result_obj.names
        frame_height, frame_width = inference_frame.shape[:2]
        frame_area = float(frame_width * frame_height)
        
        total_boxes = len(result_obj.boxes) if result_obj.boxes is not None else 0

        all_yolo_detections = [] if debug_phases is not None else None
        raw_detections = []
        if result_obj.boxes is not None:
            for idx, box in enumerate(result_obj.boxes):
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cls_id = int(box.cls[0].item())
                confidence = float(box.conf[0].item())
                class_name = class_names.get(cls_id, str(cls_id))

                if all_yolo_detections is not None:
                    all_yolo_detections.append({
                        "idx": idx,
                        "class_name": class_name,
                        "class_id": cls_id,
                        "confidence": round(confidence, 4),
                        "bbox_px": [round(x1,1), round(y1,1), round(x2,1), round(y2,1)],
                        "is_mobility_relevant": class_name in MOBILITY_RELEVANT_CLASSES
                    })

                if class_name not in MOBILITY_RELEVANT_CLASSES:
                    continue

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

        if debug_phases is not None:
            debug_phases['total_yolo_boxes'] = total_boxes
            debug_phases['mobility_filtered_detections'] = len(raw_detections)
            debug_phases['all_yolo_detections'] = all_yolo_detections
            debug_phases['parse_time_ms'] = round((_time.time() - _t5) * 1000, 1)

        # ---- PHASE 7: PROXIMITY / WALL DETECTION (fills YOLO blind spot) ----
        _t6 = _time.time()
        proximity_result = analyze_scene_proximity(frame)
        if debug_phases is not None:
            debug_phases['proximity_result'] = proximity_result
            debug_phases['proximity_time_ms'] = round((_time.time() - _t6) * 1000, 1)
        
        if proximity_result["is_obstructed"] and len(raw_detections) <= 1:
            synthetic_confidence = min(0.90, proximity_result["obstruction_confidence"] + 0.25)
            reason = proximity_result["reason"]
            label_map = {
                "wall_or_flat_surface": "wall",
                "very_close_object": "close obstacle",
                "large_uniform_surface": "large surface",
            }
            synthetic_label = label_map.get(reason, "obstacle")
            raw_detections.append(RawDetection(
                class_id=9999,
                class_name=synthetic_label,
                confidence=synthetic_confidence,
                bbox=BoundingBox(x1=0.1, y1=0.1, x2=0.9, y2=0.9),
                frame_width=frame_width,
                frame_height=frame_height,
            ))
            if debug_phases is not None:
                debug_phases['synthetic_detection_injected'] = True
                debug_phases['synthetic_label'] = synthetic_label
        else:
            if debug_phases is not None:
                debug_phases['synthetic_detection_injected'] = False

        # ---- PHASE 8: Run robust pipeline ----
        _t7 = _time.time()
        session_id = request.session_id or f"session_{request.user_id}"
        pipeline = get_session_pipeline(session_id)

        detection_result = pipeline.process_frame(
            raw_detections=raw_detections,
            frame_width=frame_width,
            frame_height=frame_height
        )
        if debug_phases is not None:
            debug_phases['pipeline_time_ms'] = round((_time.time() - _t7) * 1000, 1)
            debug_phases['pipeline_debug'] = detection_result.debug_info

        # ---- PHASE 9: Convert tracked objects to obstacle list ----
        obstacles = []
        detection_coords = []  # lightweight bbox data for client-side drawing
        for obj in detection_result.tracked_objects:
            if not obj.is_persistent:
                continue

            bbox = obj.bbox_history[-1]
            area_ratio = bbox.area

            # Distance classification
            if area_ratio >= 0.24:
                distance = "immediate"
            elif area_ratio >= 0.08:
                distance = "near"
            else:
                distance = "far"

            # Direction classification (center is already 0-1 normalized)
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

            obstacle_entry = {
                "type": obj.class_name,
                "distance": distance,
                "direction": direction,
                "confidence": round(obj.smoothed_confidence, 3),
                "moving": obj.motion_state.name.lower(),
                "persistence_frames": obj.visibility_streak,
                "object_id": obj.object_id
            }
            obstacles.append(obstacle_entry)

            # Lightweight coords for client-side box rendering
            detection_coords.append({
                "x1": round(bbox.x1, 4),
                "y1": round(bbox.y1, 4),
                "x2": round(bbox.x2, 4),
                "y2": round(bbox.y2, 4),
                "label": obj.class_name,
                "confidence": round(obj.smoothed_confidence, 2),
                "distance": distance,
                "object_id": obj.object_id
            })

        if debug_phases is not None:
            debug_phases['obstacles_count'] = len(obstacles)

        # ---- PHASE 10: Draw debug bounding boxes (only if requested) ----
        annotated_b64 = None
        if request.include_debug_image:
            _t8 = _time.time()
            annotated_b64 = draw_debug_boxes(
                inference_frame,
                raw_detections,
                tracked_objects=detection_result.tracked_objects,
                risk_level=detection_result.risk_level.value,
                safe_direction=detection_result.safe_direction
            )
            if debug_phases is not None:
                debug_phases['draw_time_ms'] = round((_time.time() - _t8) * 1000, 1)

        # Log critical alert — REMOVED from detection path for performance.
        # DB writes were slowing down the pipeline on mobile/WiFi.
        # Alerts are now handled client-side. Backend logging is optional
        # and can be done via a separate /api/alerts endpoint post-hoc.
        # if detection_result.alert_triggered: ...  (disabled)

        # ---- PHASE 11: Build response (use ORJSONResponse to skip Pydantic re-validation) ----
        if debug_phases is not None:
            debug_phases['total_time_ms'] = round((_time.time() - _t0) * 1000, 1)

        return ORJSONResponse({
            "obstacles": obstacles,
            "safe_direction": detection_result.safe_direction,
            "warning_level": detection_result.risk_level.value,
            "audio_message": detection_result.audio_message,
            "detection_coords": detection_coords,
            "debug_annotated_image": annotated_b64,
            "debug_info": debug_phases,
        })

    except Exception as e:
        logger.error(f"[DETECT] exception: {e}", exc_info=True)
        message, risk = FailSafeManager.get_fallback_response("unknown_error")
        return ORJSONResponse({
            "obstacles": [],
            "safe_direction": "stop",
            "warning_level": risk.value,
            "audio_message": message,
            "debug_info": {"error": str(e), "error_type": type(e).__name__} if request.include_debug_info else None,
        })


async def _log_alert_background(user_id, session_id, detection_result, latitude, longitude):
    """Fire-and-forget alert logging to avoid blocking the detection response."""
    try:
        alert = AlertHistoryCreate(
            user_id=user_id,
            session_id=session_id,
            alert_type="obstacle",
            message=detection_result.audio_message,
            location={"latitude": latitude, "longitude": longitude} if latitude else None,
            priority=detection_result.risk_level.value
        )
        await create_alert(alert)
    except Exception as db_err:
        logger.warning(f"[DETECT] alert DB write failed: {db_err}")


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
    # Get user's emergency contacts (safe - returns [] on DB failure)
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
    
    # Try MongoDB but don't fail if unavailable (3s timeout)
    try:
        await asyncio.wait_for(db.emergency_alerts.insert_one(alert_obj.model_dump()), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB write failed for emergency alert: {e}")
    
    # Log critical alert to history (non-fatal)
    try:
        alert_log = AlertHistoryCreate(
            user_id=alert.user_id,
            alert_type="emergency",
            message=alert.message,
            location=location
        )
        await asyncio.wait_for(db.alert_history.insert_one(alert_log.model_dump()), timeout=3.0)
    except Exception as e:
        logger.warning(f"MongoDB write failed for alert history: {e}")
    
    return alert_obj


@api_router.get("/emergency-alert/user/{user_id}", response_model=List[EmergencyAlert])
async def get_user_emergency_alerts(user_id: str):
    try:
        alerts = await asyncio.wait_for(
            db.emergency_alerts.find({"user_id": user_id}).sort("created_at", -1).to_list(50),
            timeout=3.0
        )
        return [EmergencyAlert(**alert) for alert in alerts]
    except Exception as e:
        logger.warning(f"MongoDB read failed for emergency alerts: {e}")
        return []

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

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def warmup_yolo_model():
    """Eagerly load YOLO model and run full pipeline warmup to eliminate cold-start latency."""
    if YOLO_AVAILABLE:
        loop = asyncio.get_event_loop()

        def _warmup():
            try:
                model = get_yolo_model()
                if model is not None:
                    # Use production-sized image to fully pre-allocate memory
                    dummy = np.zeros((320, 320, 3), dtype=np.uint8)
                    model(dummy, imgsz=320, conf=0.35, verbose=False)
                    # Also warm up OpenCV proximity analysis (triggers JIT/init)
                    analyze_scene_proximity(dummy)
                    # Warm up detection pipeline
                    pipeline = get_session_pipeline("__warmup__")
                    pipeline.process_frame([], 480, 480)
                    logger.info("YOLO model and full pipeline warmed up successfully")
            except Exception as exc:
                logger.warning(f"YOLO warmup failed (non-fatal): {exc}")

        await loop.run_in_executor(None, _warmup)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
