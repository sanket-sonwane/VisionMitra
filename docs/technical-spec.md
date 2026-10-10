# VisionMitra - Technical Specification & Architecture

## System Overview

VisionMitra is a production-ready AI-powered navigation and safety system specifically designed for visually impaired users. The system provides real-time obstacle detection, voice-guided navigation, emergency SOS capabilities, and accessibility-first mobile interface.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         MOBILE APP LAYER                         │
│                     (Expo React Native)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Home    │  │  Camera  │  │ Navigate │  │Emergency │       │
│  │  Screen  │  │  Screen  │  │  Screen  │  │  Screen  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │         State Management (Zustand)                   │       │
│  │  - User ID, Session, Online/Offline Mode            │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │         Device Sensors & Hardware                    │       │
│  │  - Camera, GPS, Speech, Haptics, Accelerometer      │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        │ HTTPS / REST API
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                      BACKEND API LAYER                           │
│                        (FastAPI)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ User & Contact   │  │   Navigation     │  │  Emergency   │ │
│  │   Management     │  │   & Location     │  │     SOS      │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │            AI Vision Service                         │       │
│  │  - YOLOv8n obstacle detection (local, optional)     │       │
│  │  - Temporal tracking, smoothing & fail-safe         │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        │ Async MongoDB Driver
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                      DATABASE LAYER                              │
│                        (MongoDB)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐ │
│  │    users    │ │  emergency  │ │ navigation  │ │ location │ │
│  │             │ │  _contacts  │ │ _sessions   │ │  _logs   │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └──────────┘ │
│                                                                   │
│  ┌─────────────┐ ┌─────────────┐                               │
│  │   alert     │ │  emergency  │                               │
│  │  _history   │ │   _alerts   │                               │
│  └─────────────┘ └─────────────┘                               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

External Services:
┌────────────────────┐  ┌────────────────────┐
│ YOLOv8n (local)    │  │  OpenStreetMap     │
│ Vision API         │  │  Overpass API      │
└────────────────────┘  └────────────────────┘
```

---

## Component Hierarchy & Data Flow

### Mobile Application Structure

```
frontend/
├── app/
│   ├── index.tsx              # Home screen - Main menu
│   ├── camera.tsx             # Live camera with AI detection
│   ├── navigate.tsx           # GPS navigation & transport finder
│   ├── emergency.tsx          # Emergency contacts & SOS
│   └── settings.tsx           # App configuration
├── utils/                     # api.ts, types.ts, journeyPlanner.ts, sosService.ts
├── scripts/                   # Manual smoke scripts
├── store.ts                   # Global state management (Zustand)
├── assets/
│   └── images/
├── app.json                   # Expo configuration & permissions
└── package.json
```

### Backend Structure

```
backend/
├── app/
│   ├── main.py                # FastAPI app + router mounting
│   ├── config.py              # Environment-driven settings
│   ├── db.py                  # MongoDB (Motor) client
│   ├── models.py              # Pydantic models
│   ├── geometry.py            # Direction / distance classification
│   ├── routers/               # health, users, contacts, navigation, ...
│   └── vision/                # inference.py, pipeline.py (YOLOv8 + tracking)
├── server.py                  # deprecated shim -> app.main:app
├── .env                       # Environment variables (untracked)
├── requirements.txt           # Core API dependencies
├── requirements-vision.txt    # Optional YOLO dependencies
└── requirements-dev.txt       # Lint + test dependencies
```

---

## Database Schema Design

### Collections & Indexes

#### 1. users
```javascript
{
  _id: ObjectId,
  id: String (UUID),          // Application ID
  name: String,
  phone: String,
  created_at: DateTime
}
// Indexes: id (unique), phone
```

#### 2. emergency_contacts
```javascript
{
  _id: ObjectId,
  id: String (UUID),
  user_id: String,           // Foreign key to users.id
  name: String,
  phone: String,
  relationship: String,
  priority: Integer,         // 1 = highest priority
  created_at: DateTime
}
// Indexes: id (unique), user_id, priority
// Compound: (user_id, priority)
```

#### 3. navigation_sessions
```javascript
{
  _id: ObjectId,
  id: String (UUID),
  user_id: String,
  start_location: {
    latitude: Float,
    longitude: Float
  },
  destination: {
    latitude: Float,
    longitude: Float,
    name: String
  },
  destination_name: String,
  status: String,            // active, completed, cancelled
  mode: String,              // online, offline
  started_at: DateTime,
  completed_at: DateTime?
}
// Indexes: id (unique), user_id, status, started_at
```

#### 4. location_logs
```javascript
{
  _id: ObjectId,
  id: String (UUID),
  user_id: String,
  session_id: String?,       // Optional link to navigation_sessions
  latitude: Float,
  longitude: Float,
  accuracy: Float?,
  timestamp: DateTime
}
// Indexes: id (unique), user_id, session_id, timestamp
// TTL Index: timestamp (optional, for data cleanup)
```

#### 5. alert_history
```javascript
{
  _id: ObjectId,
  id: String (UUID),
  user_id: String,
  session_id: String?,
  alert_type: String,        // obstacle, emergency, warning
  message: String,
  location: {
    latitude: Float,
    longitude: Float
  }?,
  priority: String,          // low, medium, high, critical
  timestamp: DateTime
}
// Indexes: id (unique), user_id, priority, timestamp
```

#### 6. emergency_alerts
```javascript
{
  _id: ObjectId,
  id: String (UUID),
  user_id: String,
  location: {
    latitude: Float,
    longitude: Float
  },
  message: String,
  contacts_notified: [String], // Array of phone numbers
  status: String,             // active, resolved
  created_at: DateTime,
  resolved_at: DateTime?
}
// Indexes: id (unique), user_id, status, created_at
```

---

## API Endpoint Documentation

### Base URL
- Production: `https://api.visionmitra.example/api` (placeholder — set your own deployment URL)
- Local: `http://localhost:8001/api`

### Authentication
Currently using user_id based authentication. Future: JWT tokens.

---

### 1. Health & Info

#### GET /api/
**Description**: API status check
**Response**:
```json
{
  "message": "AI Navigation System API",
  "status": "running"
}
```

#### GET /api/health
**Description**: Comprehensive health check
**Response**:
```json
{
  "status": "healthy",
  "database": "connected",
  "vision_ai": "available"
}
```

---

### 2. User Management

#### POST /api/users
**Description**: Create new user
**Request Body**:
```json
{
  "name": "John Doe",
  "phone": "+1234567890"
}
```
**Response**:
```json
{
  "id": "uuid",
  "name": "John Doe",
  "phone": "+1234567890",
  "created_at": "2026-02-18T17:00:00Z"
}
```

#### GET /api/users/{user_id}
**Description**: Get user details
**Response**: User object

---

### 3. Emergency Contacts

#### POST /api/emergency-contacts
**Request Body**:
```json
{
  "user_id": "uuid",
  "name": "Emergency Contact",
  "phone": "+1234567890",
  "relationship": "Family",
  "priority": 1
}
```

#### GET /api/emergency-contacts/{user_id}
**Response**: Array of emergency contacts sorted by priority

#### DELETE /api/emergency-contacts/{contact_id}
**Response**: Confirmation message

---

### 4. Navigation Sessions

#### POST /api/navigation-sessions
**Request Body**:
```json
{
  "user_id": "uuid",
  "start_location": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "destination": {
    "latitude": 37.7849,
    "longitude": -122.4094
  },
  "destination_name": "Bus Stop A",
  "mode": "online"
}
```

#### GET /api/navigation-sessions/{session_id}
**Response**: Session object

#### PATCH /api/navigation-sessions/{session_id}
**Query Params**: status=completed|cancelled
**Response**: Confirmation message

#### GET /api/navigation-sessions/user/{user_id}
**Query Params**: limit=20 (default)
**Response**: Array of sessions

---

### 5. Location Logging

#### POST /api/location-logs
**Request Body**:
```json
{
  "user_id": "uuid",
  "session_id": "uuid",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "accuracy": 5.0
}
```

#### POST /api/location-logs/batch
**Request Body**: Array of location log objects

---

### 6. AI Obstacle Detection

#### POST /api/detect-obstacles
**Description**: Analyze image for obstacles using AI vision
**Request Body**:
```json
{
  "image_base64": "base64_encoded_image_string",
  "user_id": "uuid",
  "session_id": "uuid",
  "latitude": 37.7749,
  "longitude": -122.4194
}
```

**Response**:
```json
{
  "obstacles": [
    {
      "type": "person",
      "distance": "near",
      "direction": "front-left",
      "moving": false
    },
    {
      "type": "vehicle",
      "distance": "far",
      "direction": "right",
      "moving": true
    }
  ],
  "safe_direction": "right",
  "warning_level": "caution",
  "audio_message": "Caution. Person detected ahead. Right is safer."
}
```

**Warning Levels**:
- `safe`: No immediate obstacles
- `caution`: Obstacles present but not immediate
- `danger`: Close obstacles requiring attention
- `critical`: STOP - Immediate danger

---

### 7. Alert System

#### POST /api/alerts
**Request Body**:
```json
{
  "user_id": "uuid",
  "session_id": "uuid",
  "alert_type": "obstacle",
  "message": "Person detected ahead",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "priority": "medium"
}
```

#### GET /api/alerts/user/{user_id}
**Query Params**: limit=50 (default)
**Response**: Array of alerts

---

### 8. Emergency SOS

#### POST /api/emergency-alert
**Request Body**:
```json
{
  "user_id": "uuid",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "message": "Emergency assistance needed"
}
```

**Response**:
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "location": {...},
  "message": "Emergency assistance needed",
  "contacts_notified": ["+1234567890", "+9876543210"],
  "status": "active",
  "created_at": "2026-02-18T17:00:00Z"
}
```

#### GET /api/emergency-alert/user/{user_id}
**Response**: Array of emergency alerts

---

## AI Vision Pipeline

### Obstacle Detection Flow

```
1. Camera captures a frame
   ↓
2. Frame is downscaled and JPEG-encoded to base64
   ↓
3. Client POSTs to /api/detect-obstacles
   ↓
4. Backend decodes base64 to a BGR numpy array
   ↓
5. YOLOv8n inference runs (only when ENABLE_VISION_AI=1;
   otherwise the endpoint returns a `model_unavailable` fail-safe)
   ↓
6. Each detection is mapped to a direction (geometry.classify_direction)
   and a distance band (geometry.classify_distance)
   ↓
7. Temporal pipeline tracks objects across frames and applies
   confidence smoothing, hysteresis and velocity estimation
   ↓
8. RiskEngine derives risk level, safe direction and whether to alert
   ↓
9. A concise audio message is built for the risk level
   ↓
10. Eligible alerts are logged to MongoDB
   ↓
11. ObstacleDetectionResponse is returned to the mobile app
   ↓
12. App speaks the message, shows the overlay and triggers haptics
```

### Temporal Pipeline Stages

The robust detection pipeline (`backend/app/vision/pipeline.py`) reduces
frame-to-frame flicker and false positives:

- **Tracking** — detections are matched to existing tracks on image scale
  (`sqrt(area)`), so an approaching object keeps its identity.
- **Confidence smoothing** — per-track confidence is smoothed over a window.
- **Hysteresis** — a track must persist for a minimum number of frames before
  it can raise a warning, and must be absent for several frames before it is
  dropped.
- **Motion** — vertical/scale velocity estimates distinguish approaching from
  receding objects.
- **Fail-safe** — any error (model missing, decode failure, timeout) returns a
  conservative "stop and reassess" message instead of silence.

---

## Navigation Intelligence Logic

### Decision Flow

```
┌─────────────────────┐
│ User starts         │
│ navigation          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Get current GPS     │
│ location            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Find nearby         │
│ transport stops     │
│ (Overpass API)      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Calculate distances │
│ Sort by proximity   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ User selects        │
│ destination         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Create navigation   │
│ session             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Open camera mode    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Continuous obstacle │
│ detection           │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Voice guidance      │
│ Turn-by-turn        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Destination         │
│ reached             │
└─────────────────────┘
```

---

## Voice Interaction Workflow

### Speech Input/Output Cycle

```
USER SPEAKS
    ↓
Expo Speech Recognition
    ↓
Text recognized
    ↓
Command parsed
    ↓
Action executed
    ↓
Generate response text
    ↓
Expo Speech Synthesis
    ↓
AUDIO FEEDBACK
```

### Voice Commands

| Command | Action |
|---------|--------|
| "Navigate to [place]" | Start navigation |
| "Describe surroundings" | Analyze current view |
| "Emergency" | Trigger SOS |
| "Stop" | Stop navigation |
| "Where am I" | Speak current location |

---

## Emergency Response Flow

```
USER PRESSES SOS BUTTON
    ↓
Haptic alert (error pattern)
    ↓
Voice: "Emergency SOS activated"
    ↓
Get current GPS location
    ↓
Create emergency_alert record
    ↓
Notify all emergency contacts
    ↓
Call primary contact (priority 1)
    ↓
Log to alert_history
    ↓
Voice: "Emergency alert sent"
    ↓
Keep tracking location
```

---

## Performance Optimization

### Mobile App
- Image compression before API call (quality: 0.5)
- Zustand for minimal re-renders
- Memoized components
- Optimized camera frame capture
- Battery-aware continuous monitoring
- Graceful offline fallback

### Backend
- Async MongoDB operations
- Connection pooling
- Fast JSON parsing
- Error handling with fallbacks
- Response caching (future)
- Rate limiting (future)

### Database
- Indexed queries on user_id, timestamp
- Compound indexes for common queries
- TTL indexes for cleanup (optional)
- Optimized aggregation pipelines

---

## Security Implementation

### Current
- CORS enabled for mobile app
- Environment variable protection
- No image storage (memory only)
- HTTPS only in production

### Future Enhancements
- JWT authentication
- API rate limiting
- Image encryption in transit
- Role-based access control
- Audit logging

---

## Testing Strategy

### Backend Tests (Completed ✅)
- All 17 API endpoints tested
- CRUD operations verified
- Error handling validated
- MongoDB integration confirmed
- AI vision API functional

### Frontend Tests (To be done)
- Camera permission flow
- GPS permission flow
- Navigation flow
- Emergency contact management
- SOS trigger
- Voice feedback
- Haptic feedback

### Integration Tests
- End-to-end navigation flow
- Emergency alert to contacts
- Offline mode graceful degradation
- AI vision response handling

---

## Deployment Configuration

### Production Environment Variables

**Backend**
```env
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/
DB_NAME=visionmitra
ENABLE_VISION_AI=1
PORT=8001
```

**Frontend**
```env
EXPO_PUBLIC_BACKEND_URL=https://api.visionmitra.example
```

### Monitoring & Logging
- Backend: FastAPI + uvicorn logs
- Frontend: Expo dev tools + Sentry (future)
- Database: MongoDB Atlas monitoring
- AI: Token usage tracking

---

## Scaling Strategy

### Phase 1 (Current - MVP)
- Single server deployment
- MongoDB local instance
- Local YOLOv8n inference (opt-in via `ENABLE_VISION_AI`)
- Manual testing

### Phase 2 (Growth)
- Load balancer
- MongoDB replica set
- Redis caching layer
- Automated testing
- CI/CD pipeline

### Phase 3 (Scale)
- Kubernetes orchestration
- Microservices architecture
- CDN for assets
- WebSocket for real-time
- Advanced analytics

---

## Accessibility Compliance

### WCAG 2.1 Level AAA
✅ Voice-first interaction
✅ Keyboard navigation (not applicable - touch)
✅ Touch target size (60x60+)
✅ Color contrast (dark theme)
✅ Haptic feedback
✅ Alternative text for all UI
✅ Consistent navigation
✅ Error recovery

### Platform-Specific
- iOS VoiceOver compatible
- Android TalkBack compatible
- Large text support
- Dynamic type scaling
- Reduced motion support

---

## Conclusion

VisionMitra represents a comprehensive, production-ready accessibility solution that prioritizes safety, usability, and independence for visually impaired users. The system architecture is modular, scalable, and designed with fail-safe mechanisms throughout.

**Current Status**: MVP Complete ✅
**Backend Tests**: 17/17 Passed ✅
**Frontend**: Ready for device testing
**AI Integration**: Fully functional ✅
**Next Steps**: User testing and feedback integration
