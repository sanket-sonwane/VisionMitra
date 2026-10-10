# VisionMitra — Team Setup Guide

Complete setup instructions for running VisionMitra on your local machine.

---

## Prerequisites

1. **Python 3.10 or higher** — https://www.python.org/downloads/
   - During installation, check "Add Python to PATH".
2. **Node.js 18+ and Yarn 1.x** — https://nodejs.org/ and
   https://classic.yarnpkg.com/lang/en/docs/install/ (LTS Node recommended)
   - Verify: `node --version` and `yarn --version`
3. **Git** — https://git-scm.com/downloads
4. **MongoDB** — local install (https://www.mongodb.com/try/download/community)
   or a free MongoDB Atlas cluster (https://www.mongodb.com/cloud/atlas).
5. **Expo Go** app for on-device testing — Android or iOS.

---

## Getting Started

```bash
git clone https://github.com/sanket-sonwane/VisionMitra.git
cd VisionMitra
```

---

## Backend Setup

### 1. Create a virtual environment

**Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**macOS/Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

You should see a `(.venv)` prefix in your terminal.

### 2. Install dependencies

```bash
cd backend
pip install -r requirements-dev.txt      # core API + ruff/pytest

# Optional: enable YOLO obstacle detection
pip install -r requirements-vision.txt    # ultralytics, opencv, numpy, pillow
```

`requirements.txt` (pulled in by the others) contains the core API runtime.
Without the vision stack the API still runs; obstacle detection returns a
fail-safe response.

### 3. Start MongoDB

**Windows (if installed as a service):**
```powershell
net start MongoDB
```

**macOS/Linux:**
```bash
sudo systemctl start mongod
# or
brew services start mongodb-community
```

**MongoDB Atlas:** create a free cluster and copy the connection string
(`mongodb+srv://username:password@cluster.mongodb.net/`).

### 4. Configure environment variables

Copy the template and fill in your values:

```bash
cp backend/.env.example backend/.env
```

```env
MONGO_URL=mongodb://localhost:27017
# For Atlas: mongodb+srv://username:password@cluster.mongodb.net/

DB_NAME=visionmitra

# Set to 1 to run YOLO inference (requires requirements-vision.txt)
ENABLE_VISION_AI=1

YOLO_MODEL_PATH=yolov8n.pt
YOLO_CONF_THRESHOLD=0.35
```

> `backend/.env` is git-ignored. Never commit real credentials.

### 5. Run the backend

```bash
# From the backend directory
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# If uvicorn is not on PATH:
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Application startup complete.
```

Test it: open http://localhost:8001/api/ — you should see
`{"message": "VisionMitra API", "status": "running"}`.

---

## Frontend Setup

### 1. Install dependencies

Open a **new terminal** (keep the backend running):

```bash
cd frontend
yarn install
```

### 2. Configure the backend URL

```bash
cp frontend/.env.example frontend/.env
```

Set `EXPO_PUBLIC_BACKEND_URL` to an address your device can reach:

| Target | Value |
| --- | --- |
| Android emulator | `http://10.0.2.2:8001` |
| iOS simulator | `http://127.0.0.1:8001` |
| Physical device | `http://<your-lan-ip>:8001` |

Find your LAN IP with `ipconfig` (Windows) or `ifconfig` / `ip addr`
(macOS/Linux). The URL is resolved centrally in `frontend/utils/api.ts`.

### 3. Start Expo

```bash
npx expo start
```

Expected output:
```
Metro waiting on exp://192.168.x.x:8081
› Scan the QR code above with Expo Go (Android) or the Camera app (iOS)
```

---

## Running on Your Phone

### Option 1: Physical device (recommended)
1. Install **Expo Go** on your phone.
2. Connect the phone to the **same WiFi** as your computer.
3. Scan the QR code (Android: Expo Go → Scan QR; iOS: Camera app).

### Option 2: Android emulator
Install Android Studio, create an AVD, start it, then press `a` in the Expo
terminal.

### Option 3: iOS simulator (macOS only)
Install Xcode and its command-line tools, then press `i` in the Expo terminal.

---

## Verify Everything Works

### Backend
```bash
# Service info
curl http://localhost:8001/api/

# Health (reports DB + vision status)
curl http://localhost:8001/api/health

# Create a user
curl -X POST http://localhost:8001/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","phone":"1234567890"}'
```

Interactive API docs: http://localhost:8001/docs

### Frontend
1. The app should load the home screen.
2. Try the voice command: "Navigate".
3. Check that the main buttons work: Live Navigation, Navigate, Emergency,
   Settings.

---

## Development Workflow

**Terminal 1 — backend:**
```bash
cd backend
.venv/bin/activate              # Windows: .\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

**Terminal 2 — frontend:**
```bash
cd frontend
npx expo start
```

### Key directories

```
VisionMitra/
├── backend/
│   ├── app/                      # FastAPI application package
│   │   ├── main.py               # app + router wiring
│   │   ├── routers/              # endpoint groups
│   │   └── vision/               # YOLO inference + temporal pipeline
│   ├── requirements*.txt
│   ├── .env                      # configuration (DON'T commit)
│   └── yolov8n.pt
│
├── frontend/
│   ├── app/                      # screens (index, camera, navigate, emergency, settings)
│   ├── utils/                    # journeyPlanner, sosService, api, types
│   └── store.ts                  # global state (Zustand)
│
├── tests/                        # backend pytest suite
├── docs/                         # documentation (+ docs/history/)
└── .venv/                        # Python virtual environment (DON'T commit)
```

---

## Troubleshooting

### Backend

**`ModuleNotFoundError: No module named 'fastapi'`** — activate the virtual
environment first, then `pip install -r requirements-dev.txt`.

**`pymongo.errors.ServerSelectionTimeoutError`** — MongoDB is not running:
`net start MongoDB` (Windows) or `brew services start mongodb-community`.

**Port 8001 already in use** — use another port:
`uvicorn app.main:app --port 8002 --reload`.

**`torch` or `ultralytics` installation fails** — ensure Python 3.10+, then:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-vision.txt
```

**Health says `"vision_ai": "unavailable"`** — install
`requirements-vision.txt` and set `ENABLE_VISION_AI=1`.

### Frontend

**`Unable to resolve module`**
```bash
cd frontend
rm -rf node_modules
yarn install
```

**Can't scan QR / connection refused** — ensure the phone and computer share a
network; try `npx expo start --tunnel`; verify `EXPO_PUBLIC_BACKEND_URL`.

**Metro bundler crash** — `npx expo start --clear`.

**Camera permissions denied** — Android: Settings → Apps → Expo Go →
Permissions → Camera; iOS: Settings → Expo Go → Camera → Allow.

---

## Team Collaboration

### Git workflow
```bash
git pull origin main
git checkout -b feature/your-feature-name
# make changes
git add .
git commit -m "Add: description of changes"
git push origin feature/your-feature-name
```
Open a Pull Request on GitHub for review.

### Never commit
- `backend/.env` / `frontend/.env` (secrets)
- `.venv/`, `node_modules/`, `__pycache__/`, `.expo/`, `.metro-cache/`

These are covered by `.gitignore`.

### After pulling changes
```bash
cd backend && pip install -r requirements-dev.txt
cd ../frontend && yarn install
```

---

## Project Status

**Working features:**
- YOLOv8 object detection (car, person, bicycle, etc.)
- Real-time camera obstacle detection with temporal consistency
- Voice guidance and speech output
- GPS navigation to transport stops
- Emergency SOS system
- User and contact management
- MongoDB data persistence

**Optional / future enhancements:**
- Domain-specific obstacle-model fine-tuning
- Offline map caching
- Multi-language support

---

## Getting Help

- Post issues in the project Slack/Discord.
- Open GitHub Issues for bugs.

**Common questions:**
1. Backend won't start? → Check MongoDB is running and port 8001 is free.
2. Frontend can't connect? → Check `EXPO_PUBLIC_BACKEND_URL`.
3. Camera not working? → Check permissions in phone settings.
4. Dependencies won't install? → Check Python/Node versions.

---

## Additional Resources

- FastAPI: https://fastapi.tiangolo.com/
- Expo: https://docs.expo.dev/
- YOLOv8: https://docs.ultralytics.com/
- React Native: https://reactnative.dev/docs/getting-started
- MongoDB: https://www.mongodb.com/docs/
