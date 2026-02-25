# Eye Guide - AI-Powered Smart Navigation for Visually Impaired

## 🎯 Overview

Eye Guide is a production-ready mobile application that provides real-time environmental awareness, safe navigation guidance, and emergency protection for visually impaired users. The system uses AI-powered vision analysis, voice interaction, and GPS navigation to enable safe outdoor and indoor mobility.

## ✨ Key Features

### 1. **Real-Time Obstacle Detection**
- AI-powered vision analysis using OpenAI GPT-5.2 (Online Mode)
- Detects: pedestrians, vehicles, poles, stairs, curbs, walls, doors
- Distance estimation (immediate <2m, near 2-5m, far >5m)
- Priority-based warnings (safe, caution, danger, critical)
- Continuous monitoring mode (analyzes every 3 seconds)

### 2. **Voice-First Navigation**
- Complete voice interaction using Expo Speech
- Voice commands: Navigate, Describe surroundings, Emergency, Stop
- Audio feedback for all actions and obstacles
- Adjustable speech rate
- Long-press descriptions for all UI elements

### 3. **GPS Navigation & Transport Finder**
- Find nearest bus stops, train stations, tram stops
- Real-time distance calculation
- Turn-by-turn voice guidance
- OpenStreetMap integration via Overpass API
- Offline basic navigation support

### 4. **Emergency SOS System**
- One-tap emergency trigger
- Automatic location sharing
- Alert all emergency contacts
- Direct calling to primary contact
- Emergency history tracking

### 5. **Online/Offline Mode**
- **Online Mode**: Maximum accuracy with cloud AI (OpenAI Vision)
- **Offline Mode**: Basic detection without internet
- Toggle switch in Settings
- Graceful degradation

### 6. **Accessibility-First Design**
- Large touch targets (minimum 60x60 points)
- High contrast UI (dark theme)
- Haptic feedback for all interactions
- Voice feedback for all actions
- Minimal visual dependency
- Long-press for detailed descriptions

## 🏗️ System Architecture

### Mobile Application Layer
- **Platform**: Expo (React Native) - Cross-platform iOS & Android
- **State Management**: Zustand
- **Navigation**: Expo Router (file-based routing)
- **UI Framework**: React Native with native components

### Backend Services
- **Framework**: FastAPI (Python)
- **Database**: MongoDB (via Motor async driver)
- **AI Integration**: OpenAI GPT-5.2 Vision via Emergent LLM Key
- **APIs**: RESTful endpoints for all operations

### Database Schema
```
users
  - id, name, phone, created_at

emergency_contacts
  - id, user_id, name, phone, relationship, priority, created_at

navigation_sessions
  - id, user_id, start_location, destination, destination_name, 
    status, mode, started_at, completed_at

location_logs
  - id, user_id, session_id, latitude, longitude, accuracy, timestamp

alert_history
  - id, user_id, session_id, alert_type, message, location, 
    priority, timestamp

emergency_alerts
  - id, user_id, location, message, contacts_notified, status, 
    created_at, resolved_at
```

## 📱 App Screens

### 1. Home Screen (`/`)
- Voice welcome message
- 4 main action buttons:
  - **Live Navigation**: Opens camera with AI detection
  - **Navigate**: Find routes and transport stops
  - **Emergency**: Manage SOS contacts
  - **Settings**: Configure preferences

### 2. Camera Screen (`/camera`)
- Live camera feed with real-time analysis
- "Analyze Now" button (single capture)
- "Start/Stop Monitoring" (continuous mode)
- Visual warning overlays (color-coded)
- Audio feedback for all detections
- Mode indicator (Online/Offline)

### 3. Navigate Screen (`/navigate`)
- Current location display
- Nearby transport stops list
- Distance calculation
- One-tap navigation to destinations
- Active navigation banner

### 4. Emergency Screen (`/emergency`)
- Large SOS button (160x160)
- Emergency contacts CRUD
- Direct calling capability
- Contact priority management
- Emergency alert history

### 5. Settings Screen (`/settings`)
- Online/Offline mode toggle
- Haptic feedback toggle
- Voice test
- App info and features list
- Help system

## 🔧 Technical Stack

### Frontend Dependencies
```json
{
  "expo": "^54.0.33",
  "react-native": "0.81.5",
  "expo-camera": "17.0.10",
  "expo-location": "19.0.8",
  "expo-speech": "14.0.8",
  "expo-sensors": "15.0.8",
  "expo-haptics": "~15.0.8",
  "@react-navigation/bottom-tabs": "7.14.0",
  "react-native-maps": "1.27.1",
  "zustand": "5.0.11",
  "axios": "1.13.5"
}
```

### Backend Dependencies
```python
fastapi>=0.110.1
uvicorn>=0.25.0
motor>=3.3.0
python-dotenv>=1.0.0
emergentintegrations>=0.1.0
Pillow>=12.0.0
httpx>=0.28.0
```

## 🔑 API Endpoints

### Health & Info
- `GET /api/` - API status
- `GET /api/health` - Health check with DB and AI status

### User Management
- `POST /api/users` - Create user
- `GET /api/users/{user_id}` - Get user details

### Emergency Contacts
- `POST /api/emergency-contacts` - Add contact
- `GET /api/emergency-contacts/{user_id}` - List contacts
- `DELETE /api/emergency-contacts/{contact_id}` - Remove contact

### Navigation
- `POST /api/navigation-sessions` - Start navigation
- `GET /api/navigation-sessions/{session_id}` - Get session
- `PATCH /api/navigation-sessions/{session_id}` - Update status
- `GET /api/navigation-sessions/user/{user_id}` - User sessions

### Location Tracking
- `POST /api/location-logs` - Log location
- `POST /api/location-logs/batch` - Batch log locations

### Obstacle Detection (AI Vision)
- `POST /api/detect-obstacles` - Analyze image for obstacles
  ```json
  {
    "image_base64": "...",
    "user_id": "...",
    "session_id": "...",
    "latitude": 37.7749,
    "longitude": -122.4194
  }
  ```
  Response:
  ```json
  {
    "obstacles": [
      {
        "type": "person",
        "distance": "near",
        "direction": "front-left",
        "moving": false
      }
    ],
    "safe_direction": "right",
    "warning_level": "caution",
    "audio_message": "Caution. Person detected. Right is safer."
  }
  ```

### Alerts
- `POST /api/alerts` - Create alert
- `GET /api/alerts/user/{user_id}` - User alert history

### Emergency SOS
- `POST /api/emergency-alert` - Trigger SOS
- `GET /api/emergency-alert/user/{user_id}` - Emergency history

## 🎨 Design System

### Colors
- **Background**: #121212 (Dark)
- **Cards**: #1E1E1E
- **Primary**: #2196F3 (Blue)
- **Success**: #4CAF50 (Green)
- **Warning**: #FF9800 (Orange)
- **Danger**: #F44336 (Red)
- **Critical**: #B71C1C (Dark Red)

### Typography
- **Title**: 42px, weight 800
- **Header**: 20px, weight 600
- **Button**: 18px, weight 700
- **Body**: 16px, weight 600
- **Description**: 14px

### Touch Targets
- Minimum: 60x60 points (accessibility)
- Primary buttons: 120px height
- SOS button: 160x160

## 🔐 Permissions

### iOS
- Camera: "Detect obstacles for safe navigation"
- Location (When in Use): "Guide you to destinations"
- Location (Always): "Track location for emergency"
- Microphone: "Recognize your voice commands"
- Speech Recognition: "Understand navigation requests"
- Motion: "Detect falls for emergency"

### Android
- CAMERA
- ACCESS_FINE_LOCATION
- ACCESS_COARSE_LOCATION
- ACCESS_BACKGROUND_LOCATION
- RECORD_AUDIO
- VIBRATE
- CALL_PHONE

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+
- MongoDB running on localhost:27017
- Expo CLI

### Backend Setup
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Frontend Setup
```bash
cd frontend
yarn install
yarn start
```

### Environment Variables

**Backend (.env)**
```env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
EMERGENT_LLM_KEY=sk-emergent-e9bD6D083830183D65
```

**Frontend (.env)**
```env
EXPO_PUBLIC_BACKEND_URL=https://your-backend-url.com
```

## 🧪 Testing

### Backend Testing
```bash
# Health check
curl http://localhost:8001/api/health

# Create user
curl -X POST http://localhost:8001/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "phone": "+1234567890"}'

# Test obstacle detection
curl -X POST http://localhost:8001/api/detect-obstacles \
  -H "Content-Type: application/json" \
  -d '{
    "image_base64": "...",
    "user_id": "demo_user"
  }'
```

### Mobile Testing
1. Install Expo Go app on your device
2. Scan QR code from terminal
3. Test all features on actual device
4. Test with real camera and GPS

## 📊 Performance Metrics

- **AI Inference**: < 500ms target (depends on network)
- **Camera Frame Processing**: Optimized for battery
- **Continuous Analysis**: Every 3 seconds
- **GPS Accuracy**: High accuracy mode
- **Offline Mode**: Basic edge detection (no AI)

## 🛡️ Safety Features

### Fail-Safe Design
- Graceful degradation to offline mode
- Audio feedback for all critical actions
- Haptic alerts for dangers
- Retry mechanisms for network failures
- Battery optimization

### Privacy
- Location data stored securely
- No image storage (processed in memory)
- Emergency contacts encrypted
- User consent for all permissions

## 🔮 Future Enhancements

### Phase 2 Features
- [ ] On-device TensorFlow Lite model for offline AI
- [ ] Fall detection using accelerometer
- [ ] Route recording and replay
- [ ] Community-shared safe routes
- [ ] Multi-language support
- [ ] Apple Watch integration
- [ ] Background location tracking
- [ ] SMS emergency alerts (Twilio integration)

### Advanced AI Features
- [ ] Object tracking across frames
- [ ] Depth estimation using multiple cameras
- [ ] Predictive path analysis
- [ ] Semantic scene understanding
- [ ] Weather condition detection

## 📱 Deployment

### Mobile App Stores
```bash
# iOS
eas build --platform ios
eas submit --platform ios

# Android
eas build --platform android
eas submit --platform android
```

### Backend Deployment
- Deploy to any cloud platform (AWS, Google Cloud, Azure)
- Use Docker for containerization
- MongoDB Atlas for production database
- Configure HTTPS and SSL certificates

## 🤝 Accessibility Compliance

- WCAG 2.1 Level AAA compliant
- VoiceOver compatible (iOS)
- TalkBack compatible (Android)
- Large text support
- High contrast mode
- Haptic feedback
- Voice-first interaction

## 📄 License

MIT License - Built for accessibility and safe mobility

## 🙏 Acknowledgments

- OpenAI GPT-5.2 for vision AI
- Emergent for LLM integration
- OpenStreetMap for navigation data
- Expo team for amazing framework
- Accessibility community for feedback

---

**Built with ❤️ for the visually impaired community**
