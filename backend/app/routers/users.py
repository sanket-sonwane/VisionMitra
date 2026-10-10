"""User endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..db import db
from ..models import User, UserCreate

router = APIRouter()


@router.post("", response_model=User)
async def create_user(user: UserCreate):
    user_obj = User(**user.model_dump())
    await db.users.insert_one(user_obj.model_dump())
    return user_obj


@router.get("/{user_id}", response_model=User)
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**user)
