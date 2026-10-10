"""Emergency alert (SOS) endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from ..db import db
from ..models import AlertHistory, AlertHistoryCreate, EmergencyAlert, EmergencyAlertCreate

router = APIRouter()


async def _contact_phones(user_id: str) -> list[str]:
    contacts = (
        await db.emergency_contacts.find({"user_id": user_id}).sort("priority", 1).to_list(100)
    )
    return [contact["phone"] for contact in contacts]


@router.post("", response_model=EmergencyAlert)
async def trigger_emergency_alert(alert: EmergencyAlertCreate):
    """Record an SOS alert and which contacts were notified.

    SMS delivery itself happens on the device; this endpoint persists the event
    and, when the client did not report recipients, fills them in from the
    user's saved emergency contacts.
    """
    fallback_contacts = await _contact_phones(alert.user_id)

    location = None
    if alert.latitude is not None and alert.longitude is not None:
        location = {"latitude": alert.latitude, "longitude": alert.longitude}

    alert_obj = EmergencyAlert(
        user_id=alert.user_id,
        location=location,
        message=alert.message or "Emergency assistance needed",
        sms_mode_used=alert.sms_mode_used or "composer",
        contacts_attempted=alert.contacts_attempted or fallback_contacts,
        contacts_notified=alert.contacts_notified or fallback_contacts,
        notify_errors=alert.notify_errors or [],
    )
    await db.emergency_alerts.insert_one(alert_obj.model_dump())

    # Mirror the event into alert history so it appears in the timeline.
    alert_log = AlertHistory(
        **AlertHistoryCreate(
            user_id=alert.user_id,
            alert_type="emergency",
            message=alert_obj.message,
            priority="critical",
            location=location,
        ).model_dump()
    )
    await db.alert_history.insert_one(alert_log.model_dump())

    return alert_obj


@router.get("/user/{user_id}", response_model=list[EmergencyAlert])
async def get_user_emergency_alerts(user_id: str):
    alerts = await db.emergency_alerts.find({"user_id": user_id}).sort("created_at", -1).to_list(50)
    return [EmergencyAlert(**alert) for alert in alerts]
