"""Alert-history endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from ..db import db
from ..models import AlertHistory, AlertHistoryCreate

router = APIRouter()


@router.post("", response_model=AlertHistory)
async def create_alert(alert: AlertHistoryCreate):
    alert_obj = AlertHistory(**alert.model_dump())
    await db.alert_history.insert_one(alert_obj.model_dump())
    return alert_obj


@router.get("/user/{user_id}", response_model=list[AlertHistory])
async def get_user_alerts(user_id: str, limit: int = 50):
    alerts = (
        await db.alert_history.find({"user_id": user_id})
        .sort("timestamp", -1)
        .limit(limit)
        .to_list(limit)
    )
    return [AlertHistory(**alert) for alert in alerts]
