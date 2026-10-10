# VisionMitra — Technical Reference

VisionMitra is an accessibility-first AI mobility assistant for visually impaired
users. It combines real-time obstacle detection, voice and haptic guidance,
destination journey planning with public-transport heuristics, and SOS emergency
workflows.

> **Safety notice:** VisionMitra provides *assistive* guidance only. It is not a
> certified safety or medical device and must not be relied upon as the sole
> means of navigation or personal safety.

---

## 1) System Overview

### Core capabilities
- Real-time camera-based obstacle awareness with risk levels and spoken guidance.
- Destination planning with segmented navigation:
  - Walk to transport stop
  - Transit segment
  - Walk to final destination
- Emergency SOS flow with:
  - Contact priority ordering
  - Location-attached emergency message
  - SMS composer/direct SMS strategy (platform dependent)
- Accessibility UX:
  - Voice prompts
  - Haptic feedback
  - Simplified, high-contrast interaction patterns

### High-level architecture
- **Frontend**: Expo React Native app (`frontend/`)
- **Backend**: FastAPI + MongoDB (`backend/app/`)
- **Vision engine**: YOLOv8 + robust temporal pipeline (`backend/app/vision/`)
- **Mapping/routing data**:
  - Nominatim (geocoding)
  - Overpass API (public-transport stops)

---

## 2) Repository Structure

```text
VisionMitra/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app + router wiring
│   │   ├── config.py          # env-driven settings (paths resolved from backend/)
│   │   ├── db.py              # MongoDB (Motor) client
│   │   ├── models.py          # Pydantic request/response models
│   │   ├── geometry.py        # direction/distance classification (single source of truth)
│   │   ├── dependencies.py    # per-session detection-pipeline registry
│   │   ├── routers/           # health, users, contacts, navigation,
│   │   │                      # location_logs, alerts, emergency, detection
│   │   └── vision/
│   │       ├── inference.py   # YOLO loading, image decoding, detection parsing
│   │       └── pipeline.py    # temporal robust detection pipeline
│   ├── server.py              # deprecated shim -> app.main:app
│   ├── requirements.txt       # core API runtime
│   ├── requirements-vision.txt# optional YOLO stack
│   ├── requirements-dev.txt   # ruff + pytest
│   └── yolov8n.pt             # default YOLO weights
├── frontend/
│   ├── app/                   # index, camera, navigate, emergency, settings
│   ├── scripts/               # manual smoke scripts
│   ├── utils/                 # journeyPlanner.ts, sosService.ts, api.ts, types.ts
│   ├── store.ts
│   ├── app.json
│   └── package.json
├── tests/                     # pytest: geometry, pipeline, API integration
├── docs/                      # canonical docs + history/
├── .github/workflows/ci.yml   # CI: backend lint/tests, frontend typecheck/lint
├── Makefile                   # developer shortcuts
├── ruff.toml                  # Python lint/format config
├── README.md
├── SETUP.md
└── SECURITY.md
```

---

## 3) Technology Stack

### Frontend
- Expo SDK 54
- React Native 0.81
- Expo Router
- Zustand state management
- Expo modules: Camera, Location, Speech, Haptics, Device, Constants
- Axios for API communication

### Backend
- FastAPI + Uvicorn
- MongoDB via Motor
- Ultralytics YOLOv8 (`yolov8n.pt` default)
- OpenCV + NumPy
- Pydantic models for request/response typing

### External Services
- OpenStreetMap Nominatim (destination geocoding)
- OpenStreetMap Overpass API (transport-stop discovery)

---

## 4) Frontend Application Design

### Screens
1. **Home (`app/index.tsx`)** — entry point, voice welcome, menu navigation.
2. **Camera (`app/camera.tsx`)** — live camera capture and obstacle-analysis API
   calls, segment-aware navigation overlay, auto-progress of segment completion
   using GPS.
3. **Navigate (`app/navigate.tsx`)** — destination input (text + optional voice),
   geocoding via Nominatim, journey planning via `utils/journeyPlanner.ts`,
   navigation-session creation in the backend.
4. **Emergency (`app/emergency.tsx`)** — CRUD emergency contacts, SOS execution
   through `utils/sosService.ts`, backend logging.
5. **Settings (`app/settings.tsx`)** — online/offline mode toggle, voice/haptic
   preferences, device/app info panel.

### Shared utilities
- `utils/api.ts` — single source of truth for the backend base URL (with
  dev-friendly fallbacks) and a configured Axios instance.
- `utils/types.ts` — shared TypeScript types for API payloads.

### Frontend state model (`store.ts`)
- `userId`
- `isOnlineMode`
- `currentSession`

### Voice input runtime behavior
- Destination voice input attempts to load a native speech-recognition module
  optionally.
- In Expo Go the native module is absent, so the app degrades gracefully.
- Full speech-to-text requires a development build containing the native module.

---

## 5) Journey Planning Module

File: `frontend/utils/journeyPlanner.ts`

### Planning strategy
- Compute the direct distance between the user and the destination.
- If within a near threshold: direct-walk fallback.
- Otherwise:
  1. Query nearby transport stops around origin and destination.
  2. Evaluate candidate stop pairs with a walk + transport + walk cost heuristic.
  3. Build a segmented route.

### Overpass robustness
- Multi-endpoint fallback for Overpass.
- Request throttling + retry/backoff to handle `429/504` cases.
- Adaptive search radii (`800`, `1500`, `2500` meters).
- Extended stop-type coverage including bus stations/platforms/stations/tram stops.

### Output contract
- `JourneyPlan` with origin/destination coordinates, selected stops, ordered
  navigation segments, total distance, estimated time, and journey type
  (`DIRECT_WALK` or `TRANSPORT`).

---

## 6) Backend API Design

Base prefix: `/api`

| Group | Endpoints |
| --- | --- |
| Health | `GET /`, `GET /health` |
| Users | `POST /users`, `GET /users/{user_id}` |
| Emergency contacts | `POST /emergency-contacts`, `GET /emergency-contacts/{user_id}`, `DELETE /emergency-contacts/{contact_id}` |
| Navigation sessions | `POST /navigation-sessions`, `GET /navigation-sessions/{session_id}`, `PATCH /navigation-sessions/{session_id}`, `GET /navigation-sessions/user/{user_id}` |
| Location/alert logs | `POST /location-logs`, `POST /location-logs/batch`, `POST /alerts`, `GET /alerts/user/{user_id}` |
| Vision | `POST /detect-obstacles` |
| Pipeline diagnostics | `GET /detection-pipeline/status/{session_id}`, `POST /detection-pipeline/clear/{session_id}`, `GET /detection-pipeline/debug/{session_id}` |
| Emergency alerts | `POST /emergency-alert`, `GET /emergency-alert/user/{user_id}` |

`PATCH /navigation-sessions/{session_id}` accepts a JSON body
(`{"status": ..., "current_segment_index": ...}`) and, for backwards
compatibility, the same fields as query parameters.

---

## 7) Vision Detection Pipeline

### Inference flow (`app/vision/inference.py`, `app/routers/detection.py`)
1. Decode the base64 image.
2. Load the YOLO model lazily (`get_yolo_model`).
3. Run inference in an executor with a timeout guard.
4. Convert detections into normalized `RawDetection` objects.
5. Send detections through the robust temporal pipeline.
6. Return a structured response: obstacles, safe direction, warning level, audio
   message.

### Robust pipeline components (`app/vision/pipeline.py`)
- Object tracking with decay handling.
- Confidence smoothing and a persistence requirement.
- Motion classification (stationary/approaching/receding/sideways).
- Stable risk-decision engine with hysteresis (no level flicker).
- Alert manager with de-duplication.
- Fail-safe fallback responses for uncertain/error states.

All bounding boxes are normalized to `0.0–1.0`. Direction and distance are
derived from normalized ratios via `app/geometry.py`, which is the single source
of truth shared by the inference handler and the risk engine.

### Current model/logic constraints
- Uses generic YOLO classes and heuristic distance/direction estimation.
- Guidance quality depends on camera angle, frame rate, confidence threshold,
  and scene complexity.
- For production-grade mobility safety, dataset/domain calibration and deeper
  validation are required.

---

## 8) Emergency SOS Flow

### Functional behavior
- Requests location with a timeout.
- Builds an emergency message including a Google Maps link when available.
- Notifies contacts in priority order.
- Supports modes:
  - `composer` (open the SMS compose UI)
  - `direct` (requires an Android native module)
- Logs the emergency event to the backend when reachable.

### Resilience
- The backend base URL is resolved centrally by `frontend/utils/api.ts`, which
  falls back through configured URL, `10.0.2.2`, `127.0.0.1`, and `localhost`.

---

## 9) Data Model (MongoDB)

Collections: `users`, `emergency_contacts`, `navigation_sessions`,
`location_logs`, `alert_history`, `emergency_alerts`.

Important persisted navigation fields: `journey_plan`,
`current_segment_index`, `status` (`active/completed/cancelled`).

---

## 10) Configuration

Configuration is read from untracked `.env` files. Templates are provided:
copy `backend/.env.example` and `frontend/.env.example` and fill in real values.

### Backend environment variables
- `MONGO_URL` (default `mongodb://localhost:27017`)
- `DB_NAME` (default `visionmitra`)
- `ENABLE_VISION_AI` (default `0`; set to `1` to enable YOLO inference)
- `YOLO_MODEL_PATH` (default `yolov8n.pt`, resolved relative to `backend/`)
- `YOLO_CONF_THRESHOLD` (default `0.35`)

### Frontend environment variables
- `EXPO_PUBLIC_BACKEND_URL` — backend URL reachable from the device
  (`10.0.2.2` for the Android emulator, `127.0.0.1` for the iOS simulator, or
  your LAN IP for a physical device).

**Never commit real `.env` files.** See [`SECURITY.md`](./SECURITY.md).

---

## 11) Local Development Setup

See [`SETUP.md`](./SETUP.md) for the full walkthrough. Quick reference:

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
# Optional: enable YOLO obstacle detection
pip install -r requirements-vision.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### Frontend
```bash
cd frontend
yarn install
npx expo start -c
```

### Native speech recognition
Expo Go cannot load the native speech-recognition module. Build a dev client:
```bash
npx expo run:android
```

---

## 12) Testing and Validation

### Automated
```bash
# Backend unit tests + lint (from the repository root)
pytest
ruff check backend tests

# Frontend type check and lint
cd frontend && yarn typecheck && yarn lint
```

Or use the Makefile shortcuts: `make test`, `make lint`, `make backend`,
`make frontend`.

- `tests/test_geometry.py` and `tests/test_pipeline.py` are pure unit tests
  (no database or YOLO required).
- `tests/test_api_integration.py` runs against a live backend. Point it at a
  server with `VISIONMITRA_API_URL` (default `http://127.0.0.1:8001/api`); it
  skips automatically when the server is unreachable.

### Recommended acceptance checks
1. Camera analysis returns stable warning levels over multiple frames.
2. Route planning produces transport segments for sufficiently long trips.
3. SOS flow works with and without backend/network reachability.
4. Session segment index increments correctly and completes the route.

---

## 13) Known Operational Caveats

1. **Overpass API limits** — public endpoints can throttle (`429`) or time out
   (`504`); mitigated via retries, throttling, and endpoint fallback.
2. **Native speech module availability** — voice destination input is
   runtime-optional; full functionality requires a dev build.
3. **Model guidance calibration** — current safety guidance is heuristic and
   should be validated on real test routes before production deployment.
4. **Device-network development issues** — ensure the backend URL matches a
   host/IP the device can reach (use `10.0.2.2` for emulators).

---

## 14) Security, Privacy, and Safety Notes

- The app stores user/session/alert metadata in MongoDB.
- Location is used for navigation and emergency workflows.
- Production use should add: authentication/authorization (JWT or session),
  a stricter CORS policy, encrypted secret management, and an explicit retention
  policy for sensitive logs.
- This system provides assistive guidance and must not be treated as a sole,
  guaranteed safety mechanism.

---

## 15) Recommended Next Enhancements

1. Domain-specific obstacle-model fine-tuning for mobility hazards.
2. Automated end-to-end tests for navigation sessions.
3. Metrics/telemetry dashboards for detection confidence and false alerts.
4. Authenticated multi-user production mode.

---

## 16) Document Index

Canonical references live in [`docs/`](./docs/README.md):

- [`docs/detection-pipeline.md`](./docs/detection-pipeline.md)
- [`docs/robust-detection.md`](./docs/robust-detection.md)
- [`docs/journey-planner.md`](./docs/journey-planner.md)
- [`docs/journey-planner-quickstart.md`](./docs/journey-planner-quickstart.md)
- [`docs/system-architecture.md`](./docs/system-architecture.md)
- [`docs/technical-spec.md`](./docs/technical-spec.md)
- [`SETUP.md`](./SETUP.md)

Point-in-time implementation reports are retained under
[`docs/history/`](./docs/history/) for reference.

This README is the single operational technical reference for day-to-day
development.
