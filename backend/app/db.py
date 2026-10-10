"""MongoDB (Motor) client and database handle."""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from . import config

client = AsyncIOMotorClient(config.MONGO_URL)
db: AsyncIOMotorDatabase = client[config.DB_NAME]


def close() -> None:
    """Close the underlying Mongo client (called on application shutdown)."""
    client.close()
