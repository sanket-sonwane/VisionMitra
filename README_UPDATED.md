# VisionMitra - AI-Powered Navigation for Visually Impaired Users

## 🎯 Overview

VisionMitra (formerly Eye Guide) is an AI-powered mobility system designed to help visually impaired users navigate safely using:

- **Real-time obstacle detection** using YOLOv8 computer vision
- **Destination-based journey planning** with public transport routing
- **Voice-guided navigation** with audio instructions
- **Emergency SOS system** with location sharing
- **Segmented route execution** with progress tracking

---

## ✨ Key Features

### 1. **Obstacle Detection (Camera)**
- Real-time object detection using YOLOv8
- Audio warnings for obstacles (person, car, bicycle, etc.)
- Continuous monitoring mode (analysis every 3 seconds)
- Warning levels: Safe, Caution, Danger, Critical
- Safe direction guidance (left, right, forward, stop)

### 2. **Destination-Based Journey Planning** ⭐ NEW
- **Search any destination** by address or place name
- **Automatic route computation** using public transport
- **Segmented navigation**:
  - Segment 1: Walk to origin stop
  - Segment 2: Take bus/train/tram
  - Segment 3: Walk to final destination
- **Progress tracking** with visual and audio feedback
- **Automatic segment transitions** based on GPS location
- **Fallback to direct walk** when no transport available
- **Cost-free routing** using OpenStreetMap data

### 3. **Emergency SOS**
- Add emergency contacts with priorities
- One-tap SOS alert with location sharing
- Automatic phone call to primary contact
- SMS alerts sent to all contacts

### 4. **Settings & Accessibility**
- Online/Offline mode toggle
- Haptic feedback controls
- Voice feedback testing
- App info and feature list

---

## 🚀 New Journey Planning System

### How It Works

1. **User enters destination** (e.g., "Central Station", "123 Main St")
2. **System geocodes** location using Nominatim API
3. **Journey planner computes route**:
   - Fetches nearby transport stops (origin + destination)
   - Selects optimal stop pair using cost heuristic
   - Generates navigation segments
4. **User starts navigation** with segmented guidance
5. **System tracks progress** and auto-advances segments
6. **Journey completes** when user arrives

### Algorithm Details

**Stop Selection:**
```
For each (origin_stop, destination_stop) pair:
  cost = walk_to_origin + transport_distance + walk_to_destination
  
Select minimum cost pair
```

**Fallback Strategy:**
- Destination < 3km → Direct walk
- No stops found → Direct walk
- API timeout → Direct walk

### Technologies

- **OpenStreetMap Overpass API** - Transport stop data (free)
- **Nominatim** - Address geocoding (free)
- **Haversine formula** - Distance calculations
- **No paid APIs** - Fully open-source routing

---

## 📁 Project Structure

```
vision4-main/
├── backend/
│   ├── server.py              # FastAPI backend with journey session support
│   ├── requirements.txt       # Python dependencies
│   └── yolov8n.pt            # YOLOv8 model weights
├── frontend/
│   ├── app/
│   │   ├── index.tsx         # Home screen
│   │   ├── camera.tsx        # Camera + segmented navigation ⭐ UPDATED
│   │   ├── navigate.tsx      # Journey planning + destination input ⭐ UPDATED
│   │   ├── emergency.tsx     # Emergency contacts
│   │   └── settings.tsx      # Settings
│   ├── utils/
│   │   ├── journeyPlanner.ts           # Journey planning engine ⭐ NEW
│   │   └── journeyPlanner.test.ts     # Test suite ⭐ NEW
│   ├── store.ts              # Zustand state management
│   └── package.json
├── JOURNEY_PLANNER_DOCS.md      # Detailed implementation docs ⭐ NEW
├── JOURNEY_PLANNER_QUICKSTART.md # Quick reference guide ⭐ NEW
└── README.md
```

---

## 🔧 Installation & Setup

### Prerequisites

- **Node.js** 18+ and npm/yarn
- **Python** 3.9+
- **MongoDB** (local or cloud)
- **Expo CLI** for mobile development

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables (create .env file)
MONGO_URL=mongodb://localhost:27017
DB_NAME=vision_db
YOLO_MODEL_PATH=yolov8n.pt
YOLO_CONF_THRESHOLD=0.35

# Run server
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

**Backend API:** http://localhost:8001

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
# or
yarn install

# Set environment variables (create .env file)
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001

# Start Expo development server
npx expo start
```

**Options:**
- Press `a` - Open Android emulator
- Press `i` - Open iOS simulator
- Press `w` - Open web browser
- Scan QR code with Expo Go app on physical device

---

## 🧪 Testing

### Test Journey Planning

```bash
cd frontend/utils
npx ts-node journeyPlanner.test.ts
```

### Manual Testing Flow

1. Start backend server
2. Start frontend Expo server
3. Open app on device/emulator
4. Navigate to "Navigate" screen
5. Enter destination (e.g., "Central Station")
6. Tap "Plan Journey"
7. Review segments
8. Tap "Start Navigation"
9. Camera opens with segment overlay
10. Walk and observe automatic progress

### API Testing

```bash
# Test navigation session with journey plan
curl -X POST http://localhost:8001/api/navigation-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test_user",
    "start_location": {"latitude": 37.7749, "longitude": -122.4194},
    "destination": {"latitude": 37.8044, "longitude": -122.2712},
    "destination_name": "Oakland",
    "journey_plan": {
      "segments": [
        {"type": "WALK", "distance": 450, "instruction": "Walk to bus stop"}
      ]
    },
    "current_segment_index": 0
  }'

# Update segment progress
curl -X PATCH "http://localhost:8001/api/navigation-sessions/{id}?current_segment_index=1"
```

---

## 📊 Data Models

### JourneyPlan

```typescript
interface JourneyPlan {
  origin_coordinates: Coordinates;
  destination_coordinates: Coordinates;
  selected_origin_stop: TransportStop | null;
  selected_destination_stop: TransportStop | null;
  segments: NavigationSegment[];
  total_distance: number;        // meters
  estimated_time: number;        // minutes
  journey_type: "DIRECT_WALK" | "TRANSPORT";
}
```

### NavigationSegment

```typescript
interface NavigationSegment {
  type: "WALK" | "TRANSPORT";
  start_coordinates: Coordinates;
  end_coordinates: Coordinates;
  instruction: string;
  distance: number;              // meters
  segment_index: number;
  start_location_name?: string;
  end_location_name?: string;
  transport_type?: string;       // "Bus" | "Train" | "Tram"
}
```

### NavigationSession (Backend)

```python
class NavigationSession(BaseModel):
    id: str
    user_id: str
    start_location: dict
    destination: dict
    destination_name: str
    journey_plan: dict             # Full JourneyPlan object
    current_segment_index: int     # Track progress
    status: str                    # "active" | "completed" | "cancelled"
    mode: str                      # "online" | "offline"
```

---

## 🔌 API Endpoints

### Navigation Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/navigation-sessions` | Create session with journey plan |
| GET | `/api/navigation-sessions/{id}` | Get session details |
| PATCH | `/api/navigation-sessions/{id}` | Update status or segment index |
| GET | `/api/navigation-sessions/user/{user_id}` | Get user's sessions |

### Obstacle Detection

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/detect-obstacles` | Analyze image for obstacles |

### Emergency

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/emergency-contacts` | Add contact |
| GET | `/api/emergency-contacts/{user_id}` | Get contacts |
| DELETE | `/api/emergency-contacts/{id}` | Delete contact |
| POST | `/api/emergency-alert` | Trigger SOS alert |

---

## 🎨 UI Components

### Navigate Screen

- **Destination Input** - Text search with geocoding
- **Journey Summary** - Distance, time, segment count
- **Segment Cards** - Walk/Transport indicators, instructions, distances
- **Plan Journey Button** - Compute route
- **Start Navigation Button** - Begin guided navigation

### Camera Screen with Segmented Navigation

- **Segment Overlay** - Current segment info (top)
- **Progress Bar** - Visual completion indicator
- **Segment Counter** - "Segment 2 of 3"
- **Obstacle Status** - Warning level (center)
- **Control Buttons** - Analyze, Start/Stop monitoring

---

## 🌍 Accessibility Features

- **Voice Announcements** - Every action and instruction
- **Haptic Feedback** - Vibration on important events
- **Large Touch Targets** - Easy button interaction
- **Long-Press Descriptions** - Audio help for all buttons
- **High Contrast UI** - Dark theme with clear text
- **Progress Audio** - Distance/time announcements

---

## ⚙️ Configuration

### Journey Planner Settings

**File:** `frontend/utils/journeyPlanner.ts`

```typescript
DEFAULT_SEARCH_RADIUS = 800         // meters
MAX_STOPS_PER_QUERY = 20            // limit results
MAX_WALKING_DISTANCE = 3000         // direct walk threshold
WALKING_SPEED = 1.4                 // m/s
TRANSPORT_SPEED = 8.3               // m/s
REQUEST_TIMEOUT = 10000             // ms
```

### Camera Settings

**File:** `frontend/app/camera.tsx`

```typescript
SEGMENT_COMPLETION_THRESHOLD = 50   // meters
LOCATION_UPDATE_INTERVAL = 5000     // ms
ANALYSIS_INTERVAL = 3000            // ms (continuous mode)
```

---

## 🛠️ Development

### Add New Transport Type

1. **Update Overpass Query** (`journeyPlanner.ts`):
   ```typescript
   node["railway"="subway"](around:${radius},${lat},${lon});
   ```

2. **Add Type Mapping**:
   ```typescript
   const type = el.tags?.railway === "subway" ? "Subway" : ...
   ```

3. **Update UI Icons** (`navigate.tsx`, `camera.tsx`):
   ```typescript
   <Ionicons name={type === "Subway" ? "subway" : ...} />
   ```

### Customize Cost Function

**File:** `journeyPlanner.ts` → `computeBestStopPair()`

```typescript
// Current: Minimize total distance
const totalCost = walkToOrigin + transportDistance + walkToDestination;

// Alternative: Prefer shorter walks
const totalCost = (walkToOrigin * 2) + transportDistance + (walkToDestination * 2);

// Alternative: Prefer closer origin stops
const totalCost = (walkToOrigin * 3) + transportDistance + walkToDestination;
```

---

## 📚 Documentation

- **[JOURNEY_PLANNER_DOCS.md](JOURNEY_PLANNER_DOCS.md)** - Complete implementation details
- **[JOURNEY_PLANNER_QUICKSTART.md](JOURNEY_PLANNER_QUICKSTART.md)** - Quick reference guide
- **[TECHNICAL_SPEC.md](TECHNICAL_SPEC.md)** - Original technical specifications
- **[EYE_GUIDE_README.md](EYE_GUIDE_README.md)** - User guide

---

## 🐛 Known Issues & Limitations

- **Overpass API Rate Limiting** - Max ~2 requests per second (implemented caching)
- **Geocoding Accuracy** - Depends on OpenStreetMap data quality
- **No Real-Time Transport** - Does not include live arrival times
- **Single Transport Mode** - Does not combine multiple transport types (e.g., bus + train)
- **Straight-Line Routing** - Transport segment uses direct distance, not actual route

---

## 🔮 Future Enhancements

- [ ] Multi-modal transport (bus + train combinations)
- [ ] Real-time arrival data integration
- [ ] Route caching for frequent destinations
- [ ] Offline map support
- [ ] Turn-by-turn walking directions
- [ ] Avoid construction zones/barriers
- [ ] Preferred transport type settings
- [ ] Historical route performance tracking
- [ ] Crowdsourced accessibility data

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 License

This project is open-source and available under the MIT License.

---

## 👥 Authors

**Vision4 Team**
- AI-powered mobility for accessibility

---

## 🙏 Acknowledgments

- **YOLOv8** by Ultralytics - Object detection
- **OpenStreetMap** - Map data and APIs
- **Expo** - Cross-platform mobile framework
- **FastAPI** - Backend framework
- **React Native** - Mobile UI framework

---

## 📞 Support

For issues or questions:
- Check documentation in `/docs` folder
- Review error logs in browser/Expo console
- Test with known locations (major transit stations)
- Verify backend is running on port 8001

---

## 🎉 Version History

### v2.0.0 (February 23, 2026) - Journey Planning Release
- ✅ Added destination-based journey planning
- ✅ Implemented segmented navigation
- ✅ Added progress tracking with automatic transitions
- ✅ Enhanced backend session schema
- ✅ Created comprehensive documentation

### v1.0.0 (Initial Release)
- Real-time obstacle detection
- Nearby transport stop discovery
- Emergency SOS system
- Voice-guided navigation

---

**Status:** ✅ Production Ready  
**Current Version:** 2.0.0  
**Last Updated:** February 23, 2026
