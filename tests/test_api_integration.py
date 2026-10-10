"""Integration tests for the VisionMitra HTTP API.

These tests run against a *live* backend (they do not spin one up, because it
needs MongoDB). Point them at a server with::

    export VISIONMITRA_API_URL=http://127.0.0.1:8001/api
    pytest tests/test_api_integration.py

If the server is unreachable the whole module is skipped, so a normal unit-test
run stays green without a database.
"""

from __future__ import annotations

import os
import uuid

import pytest

requests = pytest.importorskip("requests")

BASE_URL = os.environ.get("VISIONMITRA_API_URL", "http://127.0.0.1:8001/api")

# A 1x1 PNG, used to exercise the detection endpoint's request handling.
ONE_PIXEL_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


@pytest.fixture(scope="module")
def api():
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=3)
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 - any failure means "not running"
        pytest.skip(f"Backend not reachable at {BASE_URL}: {exc}")
    return BASE_URL


@pytest.fixture(scope="module")
def user(api):
    payload = {"name": "Pytest User", "phone": f"+1-555-{uuid.uuid4().int % 10000:04d}"}
    response = requests.post(f"{api}/users", json=payload, timeout=10)
    assert response.status_code == 200, response.text
    return response.json()


def test_health(api):
    data = requests.get(f"{api}/health", timeout=10).json()
    assert data["status"] == "healthy"
    assert "vision_ai" in data


def test_user_round_trip(api, user):
    response = requests.get(f"{api}/users/{user['id']}", timeout=10)
    assert response.status_code == 200
    assert response.json()["id"] == user["id"]


def test_emergency_contact_lifecycle(api, user):
    payload = {
        "user_id": user["id"],
        "name": "Contact Person",
        "phone": "+1-555-9000",
        "relationship": "friend",
        "priority": 1,
    }
    created = requests.post(f"{api}/emergency-contacts", json=payload, timeout=10)
    assert created.status_code == 200, created.text
    contact_id = created.json()["id"]

    listed = requests.get(f"{api}/emergency-contacts/{user['id']}", timeout=10).json()
    assert any(c["id"] == contact_id for c in listed)

    deleted = requests.delete(f"{api}/emergency-contacts/{contact_id}", timeout=10)
    assert deleted.status_code == 200


def test_navigation_session_update_body_and_query(api, user):
    payload = {
        "user_id": user["id"],
        "start_location": {"latitude": 37.7749, "longitude": -122.4194},
        "destination": {"latitude": 37.7849, "longitude": -122.4094},
        "destination_name": "Union Square",
        "mode": "online",
    }
    created = requests.post(f"{api}/navigation-sessions", json=payload, timeout=10)
    assert created.status_code == 200, created.text
    session_id = created.json()["id"]

    # JSON body form
    body_update = requests.patch(
        f"{api}/navigation-sessions/{session_id}",
        json={"current_segment_index": 2},
        timeout=10,
    )
    assert body_update.status_code == 200, body_update.text
    assert body_update.json()["updated_fields"]["current_segment_index"] == 2

    # Legacy query-parameter form (older clients)
    query_update = requests.patch(
        f"{api}/navigation-sessions/{session_id}?status=completed", timeout=10
    )
    assert query_update.status_code == 200, query_update.text

    session = requests.get(f"{api}/navigation-sessions/{session_id}", timeout=10).json()
    assert session["status"] == "completed"
    assert session["current_segment_index"] == 2


def test_alert_and_location_logs(api, user):
    log = requests.post(
        f"{api}/location-logs",
        json={"user_id": user["id"], "latitude": 1.0, "longitude": 2.0, "accuracy": 5.0},
        timeout=10,
    )
    assert log.status_code == 200

    alert = requests.post(
        f"{api}/alerts",
        json={
            "user_id": user["id"],
            "alert_type": "obstacle",
            "message": "Test obstacle",
            "priority": "high",
        },
        timeout=10,
    )
    assert alert.status_code == 200

    listed = requests.get(f"{api}/alerts/user/{user['id']}", timeout=10).json()
    assert isinstance(listed, list)


def test_emergency_alert(api, user):
    response = requests.post(
        f"{api}/emergency-alert",
        json={"user_id": user["id"], "latitude": 1.0, "longitude": 2.0, "message": "Help"},
        timeout=10,
    )
    assert response.status_code == 200, response.text
    assert response.json()["user_id"] == user["id"]


def test_detect_obstacles_schema(api, user):
    response = requests.post(
        f"{api}/detect-obstacles",
        json={"image_base64": ONE_PIXEL_PNG_B64, "user_id": user["id"]},
        timeout=30,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    for field in ("obstacles", "safe_direction", "warning_level", "audio_message"):
        assert field in data
    assert data["warning_level"] in {"safe", "caution", "danger", "critical"}
