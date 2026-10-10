"""Location-log endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from ..db import db
from ..models import LocationLog, LocationLogCreate

router = APIRouter()


@router.post("", response_model=LocationLog)
async def create_location_log(log: LocationLogCreate):
    log_obj = LocationLog(**log.model_dump())
    await db.location_logs.insert_one(log_obj.model_dump())
    return log_obj


@router.post("/batch")
async def create_location_logs_batch(logs: list[LocationLogCreate]):
    log_objects = [LocationLog(**log.model_dump()) for log in logs]
    await db.location_logs.insert_many([log.model_dump() for log in log_objects])
    return {"message": f"Created {len(log_objects)} location logs"}
