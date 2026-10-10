"""Emergency-contact endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..db import db
from ..models import EmergencyContact, EmergencyContactCreate

router = APIRouter()


@router.post("", response_model=EmergencyContact)
async def create_emergency_contact(contact: EmergencyContactCreate):
    contact_obj = EmergencyContact(**contact.model_dump())
    await db.emergency_contacts.insert_one(contact_obj.model_dump())
    return contact_obj


@router.get("/{user_id}", response_model=list[EmergencyContact])
async def get_emergency_contacts(user_id: str):
    contacts = (
        await db.emergency_contacts.find({"user_id": user_id}).sort("priority", 1).to_list(100)
    )
    return [EmergencyContact(**contact) for contact in contacts]


@router.delete("/{contact_id}")
async def delete_emergency_contact(contact_id: str):
    result = await db.emergency_contacts.delete_one({"id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted successfully"}
