"""Navigation-session endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Query

from ..db import db
from ..models import (
    NavigationSession,
    NavigationSessionCreate,
    NavigationSessionUpdate,
    utc_now,
)

router = APIRouter()


@router.post("", response_model=NavigationSession)
async def create_navigation_session(session: NavigationSessionCreate):
    session_obj = NavigationSession(**session.model_dump())
    await db.navigation_sessions.insert_one(session_obj.model_dump())
    return session_obj


@router.get("/user/{user_id}", response_model=list[NavigationSession])
async def get_user_navigation_sessions(user_id: str, limit: int = 20):
    sessions = (
        await db.navigation_sessions.find({"user_id": user_id})
        .sort("started_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    return [NavigationSession(**session) for session in sessions]


@router.get("/{session_id}", response_model=NavigationSession)
async def get_navigation_session(session_id: str):
    session = await db.navigation_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return NavigationSession(**session)


@router.patch("/{session_id}")
async def update_navigation_session(
    session_id: str,
    update: NavigationSessionUpdate | None = Body(default=None),
    status: str | None = Query(default=None),
    current_segment_index: int | None = Query(default=None),
):
    """Update a session.

    Accepts a JSON body (`{"status": ..., "current_segment_index": ...}`) and
    also legacy query parameters, which older app builds still send.
    """
    new_status = update.status if update and update.status is not None else status
    new_index = (
        update.current_segment_index
        if update and update.current_segment_index is not None
        else current_segment_index
    )

    update_data: dict = {}
    if new_status is not None:
        update_data["status"] = new_status
        if new_status in ("completed", "cancelled"):
            update_data["completed_at"] = utc_now()
    if new_index is not None:
        update_data["current_segment_index"] = new_index

    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")

    result = await db.navigation_sessions.update_one({"id": session_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session updated successfully", "updated_fields": update_data}
