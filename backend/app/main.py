"""VisionMitra FastAPI application entrypoint.

Run from the `backend/` directory:

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from . import db, dependencies
from .routers import (
    alerts,
    contacts,
    detection,
    emergency,
    health,
    location_logs,
    navigation,
    users,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("VisionMitra backend starting")
    yield
    dependencies.reset()
    db.close()
    logger.info("VisionMitra backend stopped")


app = FastAPI(title="VisionMitra API", version="1.0.0", lifespan=lifespan)

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(contacts.router, prefix="/emergency-contacts", tags=["contacts"])
api_router.include_router(navigation.router, prefix="/navigation-sessions", tags=["navigation"])
api_router.include_router(location_logs.router, prefix="/location-logs", tags=["location"])
api_router.include_router(alerts.router, prefix="/alerts", tags=["alerts"])
api_router.include_router(emergency.router, prefix="/emergency-alert", tags=["emergency"])
api_router.include_router(detection.router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
