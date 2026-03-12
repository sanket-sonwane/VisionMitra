# VisionMitra - Team Setup Guide

Complete setup instructions for running VisionMitra on your local machine.

---

## 📋 Prerequisites

Before starting, install these tools on your system:

### Required Software:
1. **Python 3.8 or higher** (Python 3.14 recommended)
   - Download: https://www.python.org/downloads/
   - ⚠️ During installation, check "Add Python to PATH"

2. **Node.js 18+ and npm**
   - Download: https://nodejs.org/ (LTS version recommended)
   - Verify: `node --version` and `npm --version`

3. **Git**
   - Download: https://git-scm.com/downloads
   - Verify: `git --version`

4. **MongoDB**
   - Option A: Local install: https://www.mongodb.com/try/download/community
   - Option B: Use MongoDB Atlas (cloud): https://www.mongodb.com/cloud/atlas
   - Verify local MongoDB: `mongod --version`

5. **Expo Go App** (for mobile testing)
   - Android: https://play.google.com/store/apps/details?id=host.exp.exponent
   - iOS: https://apps.apple.com/app/expo-go/id982107779

---

## 🚀 Getting Started

### Step 1: Clone the Repository

```bash
git clone https://github.com/sanket-sonwane/VisionMitra.git
cd VisionMitra
```

---

## 🔧 Backend Setup

### Step 1: Create Python Virtual Environment

**Windows (PowerShell):**
```powershell
python -m venv .venv-1
.\.venv-1\Scripts\Activate.ps1
```

**macOS/Linux:**
```bash
python3 -m venv .venv-1
source .venv-1/bin/activate
```

You should see `(.venv-1)` prefix in your terminal.

### Step 2: Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

⏱️ This will take 5-10 minutes. It installs ~113 packages including:
- FastAPI, Uvicorn (web server)
- Ultralytics (YOLOv8 for object detection)
- OpenCV (image processing)
- Motor (MongoDB async driver)
- PyTorch (deep learning)

### Step 3: Start MongoDB

**Windows (if installed as service):**
```powershell
net start MongoDB
```

**macOS/Linux:**
```bash
sudo systemctl start mongod
# or
brew services start mongodb-community
```

**Using MongoDB Atlas (Cloud):**
- Create free cluster at https://www.mongodb.com/cloud/atlas
- Get connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/`)

### Step 4: Configure Environment Variables

Edit `backend/.env` file with your settings:

```env
# MongoDB Configuration
MONGO_URL=mongodb://localhost:27017
# For MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net/

# Database name
DB_NAME=visionmitra_db

# Emergent LLM API Key (optional - for advanced AI features)
EMERGENT_LLM_KEY=your-key-here

# YOLO Model Settings
YOLO_MODEL_PATH=yolov8n.pt
YOLO_CONF_THRESHOLD=0.35
```

**Note:** The `EMERGENT_LLM_KEY` is optional. The app works with just YOLO detection. Get it from https://www.emergentagi.com/ if you want advanced AI scene descriptions.

### Step 5: Run the Backend Server

```bash
# Make sure you're in the backend directory
cd backend

# Windows
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# If uvicorn not found, use:
python -m uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

✅ **Success!** You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

🌐 **Test Backend:** Open http://localhost:8001 in your browser
- Should show: `{"message": "Eye Guide Backend Running"}`

---

## 📱 Frontend Setup

### Step 1: Install Frontend Dependencies

Open a **NEW terminal window** (keep backend running):

```bash
cd VisionMitra/frontend
npm install
```

⏱️ This will take 3-5 minutes.

### Step 2: Install Expo CLI (if not already installed)

```bash
npm install -g expo-cli
```

### Step 3: Update Backend URL (if needed)

If your backend is running on a different IP/port, update `frontend/app/camera.tsx`:

Look for:
```typescript
const BACKEND_URL = 'http://192.168.x.x:8001';
```

Change to your computer's IP address. Find your IP:
- **Windows:** `ipconfig` (look for IPv4 Address)
- **macOS/Linux:** `ifconfig` or `ip addr`

### Step 4: Start Expo Development Server

```bash
# Make sure you're in the frontend directory
cd frontend
npx expo start
```

✅ **Success!** You should see:
```
Metro waiting on exp://192.168.x.x:8081
› Scan the QR code above with Expo Go (Android) or the Camera app (iOS)
```

---

## 📲 Running on Your Phone

### Option 1: Physical Device (Recommended)

1. **Install Expo Go** app on your phone
2. **Connect to same WiFi** as your computer
3. **Scan QR code** from terminal:
   - **Android:** Open Expo Go app → Scan QR
   - **iOS:** Open Camera app → Point at QR → Tap notification

### Option 2: Android Emulator

1. Install Android Studio: https://developer.android.com/studio
2. Set up Android Virtual Device (AVD)
3. Start emulator
4. In Expo terminal, press `a` for Android

### Option 3: iOS Simulator (macOS only)

1. Install Xcode from Mac App Store
2. Install Xcode Command Line Tools: `xcode-select --install`
3. In Expo terminal, press `i` for iOS

---

## ✅ Verify Everything Works

### Test Backend:

**1. Check API Documentation:**
```
http://localhost:8001/docs
```

**2. Test Health Endpoint:**
```bash
curl http://localhost:8001/
# Should return: {"message":"Eye Guide Backend Running"}
```

**3. Test User Creation:**
```bash
curl -X POST http://localhost:8001/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","phone":"1234567890"}'
```

### Test Frontend:

1. App should load showing home screen
2. Try voice command: "Navigate"
3. Check all 4 main buttons work:
   - Live Navigation
   - Navigate
   - Emergency
   - Settings

---

## 🛠️ Development Workflow

### Daily Workflow:

**Terminal 1 - Backend:**
```bash
cd VisionMitra/backend
.\.venv-1\Scripts\Activate.ps1  # or source .venv-1/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

**Terminal 2 - Frontend:**
```bash
cd VisionMitra/frontend
npx expo start
```

### Key Directories:

```
VisionMitra/
├── backend/
│   ├── server.py              # Main API endpoints
│   ├── robust_detection_pipeline.py  # YOLO detection logic
│   ├── requirements.txt       # Python dependencies
│   └── .env                   # Configuration (DON'T commit this!)
│
├── frontend/
│   ├── app/
│   │   ├── index.tsx         # Home screen
│   │   ├── camera.tsx        # Live detection screen
│   │   ├── navigate.tsx      # GPS navigation
│   │   ├── emergency.tsx     # SOS system
│   │   └── settings.tsx      # App settings
│   ├── package.json          # Node dependencies
│   └── store.ts              # Global state (Zustand)
│
└── .venv-1/                  # Python virtual environment (DON'T commit!)
```

---

## 🐛 Troubleshooting

### Backend Issues

**Problem: `ModuleNotFoundError: No module named 'fastapi'`**
```bash
# Activate virtual environment first!
.\.venv-1\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Problem: `pymongo.errors.ServerSelectionTimeoutError`**
- MongoDB is not running
- Windows: `net start MongoDB`
- macOS/Linux: `brew services start mongodb-community`

**Problem: Port 8001 already in use**
```bash
# Use different port
uvicorn server:app --host 0.0.0.0 --port 8002 --reload
```

**Problem: `torch` or `ultralytics` installation fails**
- Make sure you have Python 3.8+
- Try: `pip install torch --index-url https://download.pytorch.org/whl/cpu`
- Then: `pip install ultralytics`

### Frontend Issues

**Problem: `Unable to resolve module`**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**Problem: Can't scan QR code / Connection refused**
- Ensure phone and computer on **same WiFi**
- Try tunnel mode: `npx expo start --tunnel`
- Update `BACKEND_URL` in `camera.tsx` to your computer's IP

**Problem: Metro bundler crash**
```bash
npx expo start --clear
```

**Problem: Camera permissions denied**
- Android: Settings → Apps → Expo Go → Permissions → Camera
- iOS: Settings → Expo Go → Camera → Allow

### Python Version Issues

**If using Python < 3.10:**
```bash
# Downgrade some packages
pip install numpy==2.2.6 pandas==2.2.3
```

---

## 👥 Team Collaboration Tips

### Git Workflow:

**Before starting work:**
```bash
git pull origin main
```

**Creating a feature branch:**
```bash
git checkout -b feature/your-feature-name
# Make changes
git add .
git commit -m "Add: description of changes"
git push origin feature/your-feature-name
```

**Create Pull Request on GitHub for review**

### Files to NEVER commit:
- `backend/.env` (contains API keys)
- `.venv-1/` (virtual environment)
- `node_modules/` (npm packages)
- `__pycache__/` (Python cache)
- `.expo/` (Expo cache)

These are already in `.gitignore`.

### Backend Changes:
After pulling new backend changes:
```bash
cd backend
pip install -r requirements.txt  # Install any new dependencies
```

### Frontend Changes:
After pulling new frontend changes:
```bash
cd frontend
npm install  # Install any new dependencies
```

---

## 📊 Project Status

**✅ Working Features:**
- YOLOv8 object detection (car, person, bicycle, etc.)
- Real-time camera obstacle detection
- Voice guidance and speech output
- GPS navigation to transport stops
- Emergency SOS system
- User and contact management
- MongoDB data persistence

**🚧 Optional Enhancements:**
- Emergent LLM integration (for rich AI descriptions)
- Offline map caching
- Multi-language support

---

## 🆘 Getting Help

**Team Communication:**
- Post issues in project Slack/Discord channel
- Create GitHub Issues for bugs
- Document solutions in team wiki

**Common Questions:**
1. **Backend won't start?** → Check MongoDB is running, check port 8001 is free
2. **Frontend can't connect?** → Update BACKEND_URL to your computer's IP
3. **Camera not working?** → Check permissions in phone settings
4. **Dependencies won't install?** → Check Python/Node versions

---

## 📚 Additional Resources

- **FastAPI Docs:** https://fastapi.tiangolo.com/
- **Expo Docs:** https://docs.expo.dev/
- **YOLOv8 Docs:** https://docs.ultralytics.com/
- **React Native:** https://reactnative.dev/docs/getting-started
- **MongoDB:** https://www.mongodb.com/docs/

---

## 🎯 Quick Command Reference

```bash
# Backend
cd backend
.\.venv-1\Scripts\Activate.ps1
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend
cd frontend
npx expo start

# MongoDB (Windows)
net start MongoDB

# Git
git pull origin main
git status
git add .
git commit -m "message"
git push origin branch-name
```

---

**Happy Coding! 🚀**

For questions, contact the team lead or check the project documentation.
