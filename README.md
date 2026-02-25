# VisionMitra (Eye Guide) — Technical Specification

VisionMitra is an accessibility-first AI mobility assistant for visually impaired users. It combines real-time obstacle detection, voice and haptic guidance, destination journey planning with public transport heuristics, and SOS emergency workflows.

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
	- Simplified high-contrast interaction patterns

### High-level architecture
- **Frontend**: Expo React Native app (`frontend/`)
- **Backend**: FastAPI + MongoDB (`backend/server.py`)
- **Vision engine**: YOLOv8 + robust temporal pipeline (`backend/robust_detection_pipeline.py`)
- **Mapping/routing data**:
	- Nominatim (geocoding)
	- Overpass API (public transport stops)

---

## 2) Repository Structure

```text
vision4-main/
├── backend/
│   ├── server.py
│   ├── robust_detection_pipeline.py
│   ├── requirements.txt
│   └── yolov8n.pt
├── frontend/
│   ├── app/
│   │   ├── index.tsx
│   │   ├── camera.tsx
│   │   ├── navigate.tsx
│   │   ├── emergency.tsx
│   │   └── settings.tsx
│   ├── utils/
│   │   ├── journeyPlanner.ts
│   │   └── sosService.ts
│   ├── store.ts
│   ├── app.json
│   └── package.json
├── tests/
└── docs/*.md
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
- OpenStreetMap Overpass API (transport stop discovery)

---

## 4) Frontend Application Design

### Screens
1. **Home (`app/index.tsx`)**
	 - Entry point
	 - Voice welcome and menu navigation

2. **Camera (`app/camera.tsx`)**
	 - Live camera capture + obstacle analysis API calls
	 - Segment-aware navigation overlay
	 - Auto-progress segment completion using GPS

3. **Navigate (`app/navigate.tsx`)**
	 - Destination input (text + optional voice input runtime)
	 - Geocoding via Nominatim
	 - Journey planning via `utils/journeyPlanner.ts`
	 - Navigation session creation in backend

4. **Emergency (`app/emergency.tsx`)**
	 - CRUD emergency contacts
	 - SOS execution through `utils/sosService.ts`
	 - Backend URL fallback for local/dev networking resilience

5. **Settings (`app/settings.tsx`)**
	 - Online/offline mode toggle
	 - Voice/haptic preferences
	 - Device/app info panel

### Frontend state model (`store.ts`)
- `userId`
- `isOnlineMode`
- `currentSession`

### Voice input runtime behavior
- Destination voice input attempts to load native speech recognition module optionally.
- In Expo Go, native speech-recognition module is not present, so app degrades gracefully.
- Full speech-to-text requires a development build containing the native module.

---

## 5) Journey Planning Module

File: `frontend/utils/journeyPlanner.ts`

### Planning strategy
- Compute direct distance between user and destination.
- If near threshold: direct walk fallback.
- Otherwise:
	1. Query nearby transport stops around origin and destination.
	2. Evaluate candidate stop pairs with walk + transport + walk cost heuristic.
	3. Build segmented route.

### Overpass robustness
- Multi-endpoint fallback for Overpass.
- Request throttling + retry/backoff to handle `429/504` cases.
- Adaptive search radii (`800`, `1500`, `2500` meters).
- Extended stop type coverage including bus stations/platforms/stations/tram stops.

### Output contract
- `JourneyPlan` with:
	- origin/destination coordinates
	- selected origin/destination stops
	- ordered navigation segments
	- total distance
	- estimated time
	- journey type (`DIRECT_WALK` or `TRANSPORT`)

---

## 6) Backend API Design

Base prefix: `/api`

### Health and status
- `GET /`
- `GET /health`

### User management
- `POST /users`
- `GET /users/{user_id}`

### Emergency contacts
- `POST /emergency-contacts`
- `GET /emergency-contacts/{user_id}`
- `DELETE /emergency-contacts/{contact_id}`

### Navigation sessions
- `POST /navigation-sessions`
- `GET /navigation-sessions/{session_id}`
- `PATCH /navigation-sessions/{session_id}`
- `GET /navigation-sessions/user/{user_id}`

### Location and alert logging
- `POST /location-logs`
- `POST /location-logs/batch`
- `POST /alerts`
- `GET /alerts/user/{user_id}`

### Vision obstacle detection
- `POST /detect-obstacles`

### Detection pipeline diagnostics
- `GET /detection-pipeline/status/{session_id}`
- `POST /detection-pipeline/clear/{session_id}`
- `GET /detection-pipeline/debug/{session_id}`

### Emergency alerts
- `POST /emergency-alert`
- `GET /emergency-alert/user/{user_id}`

---

## 7) Vision Detection Pipeline

### Inference flow (`server.py`)
1. Decode base64 image.
2. Load YOLO model lazily (`get_yolo_model`).
3. Run inference in executor with timeout guard.
4. Convert detections into `RawDetection` objects.
5. Send detections through robust temporal pipeline.
6. Return structured response:
	 - obstacles
	 - safe direction
	 - warning level
	 - audio message

### Robust pipeline components (`robust_detection_pipeline.py`)
- Object tracking with decay handling.
- Confidence smoothing and persistence requirement.
- Motion classification (stationary/approaching/receding/sideways).
- Stable risk decision engine with hysteresis.
- Alert manager with deduplication and escalation.
- Fail-safe fallback responses for uncertain/error states.

### Current model/logic constraints
- Uses generic YOLO classes and heuristic distance/direction estimation.
- Guidance quality depends on camera angle, frame rate, confidence threshold, and scene complexity.
- For production-grade mobility safety, dataset/domain calibration and deeper validation are required.

---

## 8) Emergency SOS Flow

### Functional behavior
- Requests location with timeout.
- Builds emergency message including Google Maps link when available.
- Notifies contacts by priority order.
- Supports modes:
	- `composer` (open SMS compose UI)
	- `direct` (Android native module required)
- Logs emergency event to backend when reachable.

### Resilience
- Backend URL fallback strategy in emergency screen:
	- configured URL
	- `10.0.2.2`
	- `127.0.0.1`
	- `localhost`

---

## 9) Data Model Summary (MongoDB)

Collections:
- `users`
- `emergency_contacts`
- `navigation_sessions`
- `location_logs`
- `alert_history`
- `emergency_alerts`

Important persisted navigation fields:
- `journey_plan`
- `current_segment_index`
- `status` (`active/completed/cancelled`)

---

## 10) Configuration

### Frontend `.env` (example)
```env
EXPO_TUNNEL_SUBDOMAIN=eyeguide-4
EXPO_PUBLIC_BACKEND_URL=http://192.168.1.140:8001
EXPO_USE_FAST_RESOLVER="1"
```

### Backend environment variables
- `MONGO_URL` (default `mongodb://localhost:27017`)
- `DB_NAME` (default `test_database`)
- `YOLO_MODEL_PATH` (default `yolov8n.pt`)
- `YOLO_CONF_THRESHOLD` (default `0.35`)

---

## 11) Local Development Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- npm
- MongoDB instance
- Android Studio emulator or physical Android device

### Backend startup
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Frontend startup
```bash
cd frontend
npm install
npx expo start -c
```

### For speech-recognition native support
- Expo Go is insufficient for native speech recognition module usage.
- Build and run a development build:
```bash
npx expo run:android
```

---

## 12) Testing and Validation

### Available checks
- Frontend lint (`npm run lint`) — may require `yarnpkg` availability in some environments.
- Type checks (`npx tsc --noEmit`) in frontend.
- Manual journey planner script (`frontend/utils/journeyPlanner.test.ts`).
- Backend health checks:
	- `/api/health`
	- `/api/detection-pipeline/status/{session_id}`

### Recommended acceptance checks
1. Camera analysis returns stable warning levels over multiple frames.
2. Route planning produces transport segments for sufficiently long trips.
3. SOS flow works with and without backend/network reachability.
4. Session segment index increments correctly and completes route.

---

## 13) Known Operational Caveats

1. **Overpass API limits**
	 - Public endpoints can throttle (`429`) or timeout (`504`).
	 - Mitigated via retries, throttling, and endpoint fallback.

2. **Native speech module availability**
	 - Voice destination input is runtime-optional.
	 - Full feature requires dev build/native runtime.

3. **Model guidance calibration**
	 - Current safety guidance is heuristic and should be validated in real-world test routes before production deployment.

4. **Device-network development issues**
	 - Ensure backend URL matches device-accessible host/IP.
	 - Use emulator aliases (`10.0.2.2`) where appropriate.

---

## 14) Security, Privacy, and Safety Notes

- App stores user/session/alert metadata in MongoDB.
- Location is used for navigation and emergency workflows.
- Production use should add:
	- authentication and authorization (JWT/session)
	- stricter CORS policy
	- encrypted secrets management
	- explicit retention policy for sensitive logs
- This system provides assistive guidance and must not be treated as a sole guaranteed safety mechanism.

---

## 15) Recommended Next Enhancements

1. Domain-specific obstacle model fine-tuning for mobility hazards.
2. Unified backend URL fallback utility across all frontend screens.
3. Automated integration tests for end-to-end navigation sessions.
4. Add metrics/telemetry dashboards for detection confidence and false alerts.
5. Implement authenticated multi-user production mode.

---

## 16) Document Index

Additional project documents:
- `TECHNICAL_SPEC.md`
- `SYSTEM_ARCHITECTURE.md`
- `JOURNEY_PLANNER_DOCS.md`
- `ROBUST_DETECTION_ARCHITECTURE.md`
- `ROBUST_PIPELINE_IMPLEMENTATION.md`
- `SOS_IMPLEMENTATION_SUMMARY.md`

This README is intended to be the single operational technical reference for day-to-day development.
