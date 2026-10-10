"""Pydantic request/response models for the VisionMitra API.

Each persisted document has a matching `*Create` input model so clients cannot
override server-generated fields (id, timestamps, status, ...).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    """Timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


# --- Users ------------------------------------------------------------------


class User(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    phone: str
    created_at: datetime = Field(default_factory=utc_now)


class UserCreate(BaseModel):
    name: str
    phone: str


# --- Emergency contacts -----------------------------------------------------


class EmergencyContact(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    name: str
    phone: str
    relationship: str
    priority: int = 1
    created_at: datetime = Field(default_factory=utc_now)


class EmergencyContactCreate(BaseModel):
    user_id: str
    name: str
    phone: str
    relationship: str
    priority: int = 1


# --- Navigation sessions ----------------------------------------------------


class NavigationSession(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    start_location: dict
    destination: dict | None = None
    destination_name: str | None = None
    journey_plan: dict | None = None
    current_segment_index: int = 0
    status: str = "active"  # active | completed | cancelled
    mode: str = "online"  # online | offline
    started_at: datetime = Field(default_factory=utc_now)
    completed_at: datetime | None = None


class NavigationSessionCreate(BaseModel):
    user_id: str
    start_location: dict
    destination: dict | None = None
    destination_name: str | None = None
    journey_plan: dict | None = None
    current_segment_index: int = 0
    mode: str = "online"


class NavigationSessionUpdate(BaseModel):
    """Fields a client may patch on an active session."""

    status: str | None = None
    current_segment_index: int | None = None


# --- Location logs ----------------------------------------------------------


class LocationLog(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    session_id: str | None = None
    latitude: float
    longitude: float
    accuracy: float | None = None
    timestamp: datetime = Field(default_factory=utc_now)


class LocationLogCreate(BaseModel):
    user_id: str
    session_id: str | None = None
    latitude: float
    longitude: float
    accuracy: float | None = None


# --- Alert history ----------------------------------------------------------


class AlertHistory(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    session_id: str | None = None
    alert_type: str  # obstacle | emergency | warning
    message: str
    location: dict | None = None
    priority: str = "medium"  # low | medium | high | critical
    timestamp: datetime = Field(default_factory=utc_now)


class AlertHistoryCreate(BaseModel):
    user_id: str
    session_id: str | None = None
    alert_type: str
    message: str
    location: dict | None = None
    priority: str = "medium"


# --- Obstacle detection -----------------------------------------------------


class ObstacleDetectionRequest(BaseModel):
    image_base64: str
    user_id: str
    session_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class ObstacleDetectionResponse(BaseModel):
    obstacles: list[dict]
    safe_direction: str | None = None
    warning_level: str  # safe | caution | danger | critical
    audio_message: str


# --- Emergency alerts -------------------------------------------------------


class EmergencyAlert(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    location: dict | None = None
    message: str
    sms_mode_used: str = "composer"  # composer | direct | failed
    contacts_attempted: list[str] = Field(default_factory=list)
    contacts_notified: list[str] = Field(default_factory=list)
    notify_errors: list[str] = Field(default_factory=list)
    status: str = "active"  # active | resolved
    created_at: datetime = Field(default_factory=utc_now)
    resolved_at: datetime | None = None


class EmergencyAlertCreate(BaseModel):
    user_id: str
    latitude: float | None = None
    longitude: float | None = None
    message: str | None = "Emergency assistance needed"
    sms_mode_used: str | None = "composer"
    contacts_attempted: list[str] = Field(default_factory=list)
    contacts_notified: list[str] = Field(default_factory=list)
    notify_errors: list[str] = Field(default_factory=list)


# --- Pipeline diagnostics ---------------------------------------------------

DebugInfo = dict[str, object]
