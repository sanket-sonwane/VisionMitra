"""Health and service-info endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from ..db import db
from ..vision import inference

router = APIRouter(tags=["health"])


@router.get("/")
async def root():
    return {"message": "VisionMitra API", "status": "running"}


@router.get("/health")
async def health_check():
    try:
        await db.command("ping")
        return {
            "status": "healthy",
            "database": "connected",
            "vision_ai": "available" if inference.vision_available() else "unavailable",
        }
    except Exception as exc:
        return {"status": "unhealthy", "error": str(exc)}
