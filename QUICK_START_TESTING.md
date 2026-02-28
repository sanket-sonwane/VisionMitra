# YOLOv8m Upgrade - Quick Start Testing Guide

## 🚀 Quick Deployment Steps

### 1. Install Updated Dependencies
```bash
cd backend
pip install -r requirements.txt
```

**Key new dependencies**:
- `opencv-python==4.10.0.84` (for CLAHE preprocessing)
- `torch>=2.0.0` (for YOLOv8m)
- `torchvision>=0.15.0` (for YOLOv8m)
- `ultralytics==8.3.178` (YOLOv8m model)

### 2. Download YOLOv8m Model (First Time Only)
```bash
python -c "from ultralytics import YOLO; YOLO('yolov8m.pt')"
```

**Expected output**:
```
Downloading yolov8m.pt...
100%|████████████████████████████████████████| 49.7M/49.7M
Model loaded successfully
```

### 3. Start Backend Server
```bash
# From backend directory
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

**Expected output**:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Loading YOLOv8m model from yolov8m.pt...
INFO:     YOLOv8m model loaded successfully in 2.34s
INFO:     Model parameters: conf=0.35, iou=0.5, imgsz=1280
INFO:     Application startup complete.
```

---

## 🧪 Testing the Upgrade

### Test 1: Basic Detection
```bash
curl -X POST http://localhost:8000/api/detect-obstacles \
  -H "Content-Type: application/json" \
  -d '{
    "image_base64": "YOUR_BASE64_IMAGE",
    "user_id": "test_user_123",
    "session_id": "test_session_456"
  }'
```

**Expected response**:
```json
{
  "obstacles": [
    {
      "type": "person",
      "distance": "near",
      "direction": "front",
      "confidence": 0.87,
      "moving": "stationary",
      "persistence_frames": 3,
      "object_id": "obj_1",
      "center": [640.5, 480.2],
      "area": 45000.0
    }
  ],
  "safe_direction": "left",
  "warning_level": "caution",
  "audio_message": "Caution. Person nearby. Walk carefully."
}
```

### Test 2: Health Check
```bash
curl http://localhost:8000/api/health
```

**Expected response**:
```json
{
  "status": "healthy",
  "database": "connected",
  "vision_ai": "available"
}
```

### Test 3: Pipeline Status
```bash
curl http://localhost:8000/api/detection-pipeline/status/test_session_456
```

**Expected response**:
```json
{
  "session_id": "test_session_456",
  "frame_count": 5,
  "active_objects": 2,
  "current_risk": "caution",
  "frame_history_size": 5,
  "status": "active"
}
```

---

## 🔍 Verification Checklist

### Model & Configuration
- [ ] YOLOv8m model downloaded (~50MB file `yolov8m.pt`)
- [ ] Server starts without errors
- [ ] Log shows "YOLOv8m model loaded successfully"
- [ ] Log shows "imgsz=1280" (not default 640)

### Preprocessing Pipeline
- [ ] CLAHE preprocessing applied (check logs for "Processing frame")
- [ ] Gaussian blur applied (no errors in preprocessing)
- [ ] Original aspect ratio preserved

### Detection Accuracy
- [ ] Small objects detected (test with distant obstacles)
- [ ] Low-light images processed successfully
- [ ] Moving objects tracked across frames
- [ ] Tracking IDs persist (same object keeps same ID)

### Safety Features
- [ ] Mobility classes filtered correctly (only 12 classes)
- [ ] Distance estimation includes vertical position boost
- [ ] 5-zone direction classification (not 5 zones, not old 4)
- [ ] Audio messages are natural and clear
- [ ] Edge cases handled gracefully (test with bad image)

### Performance
- [ ] Inference completes within timeout (< 10s)
- [ ] 500ms minimum interval enforced
- [ ] No memory leaks (monitor over time)
- [ ] Multiple users supported (test concurrent requests)

---

## 📊 Performance Benchmarks

### Expected Latency (GPU)
| Operation | Time | Notes |
|-----------|------|-------|
| Model Loading | 1-3s | First time only |
| Image Decode | 5-20ms | Depends on size |
| Preprocessing | 10-30ms | CLAHE + Blur |
| Inference (YOLOv8m) | 200-500ms | With imgsz=1280 |
| Tracking Pipeline | 5-15ms | Temporal processing |
| **Total per frame** | **250-600ms** | Acceptable for safety |

### Expected Latency (CPU)
| Operation | Time | Notes |
|-----------|------|-------|
| Inference (YOLOv8m) | 2-5s | Much slower on CPU |
| **Total per frame** | **2-5s** | Still usable |

**GPU recommended for production**

---

## 🐛 Common Issues & Solutions

### Issue 1: "No module named 'cv2'"
```bash
pip install opencv-python==4.10.0.84
```

### Issue 2: "No module named 'torch'"
```bash
pip install torch>=2.0.0 torchvision>=0.15.0
```

### Issue 3: "YOLO model file not found"
```bash
# Manually download
python -c "from ultralytics import YOLO; YOLO('yolov8m.pt')"
```

### Issue 4: "CUDA out of memory"
**Solution 1**: Use CPU mode
```python
# In server.py, force CPU
model = YOLO('yolov8m.pt').to('cpu')
```

**Solution 2**: Reduce batch size
```bash
export YOLO_IMAGE_SIZE=640  # Reduce from 1280
```

### Issue 5: "Inference taking too long (>10s)"
```bash
# Check GPU availability
python -c "import torch; print(torch.cuda.is_available())"

# If False, install GPU support
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

---

## 🔬 Advanced Testing Scenarios

### Scenario 1: Low Light Conditions
Test with dark/night images to verify CLAHE enhancement works.

**Expected**:
- Detections still work in low light
- Log shows preprocessing applied
- No crashes or timeouts

### Scenario 2: Multiple Moving Objects
Test with video of busy street or crowded area.

**Expected**:
- Multiple objects tracked
- Each has unique `object_id`
- Motion state correctly classified
- Risk level escalates with more objects

### Scenario 3: Approaching Object
Test with sequence showing object moving toward camera.

**Expected**:
- Distance changes: far → near → immediate
- Motion classified as "approaching"
- Audio message warns about approaching object
- Risk level: DANGER or CRITICAL

### Scenario 4: Edge Cases
Test with:
- Empty frame (black image)
- Corrupt base64
- Extremely large image (>5MB)
- Extremely small image (<100px)

**Expected**:
- No crashes
- Fallback responses returned
- Clear error messages in logs
- Conservative guidance provided

### Scenario 5: Concurrent Users
Send 10 simultaneous requests from different sessions.

**Expected**:
- All requests processed
- No cross-contamination between sessions
- Each session maintains separate tracking state
- No race conditions or errors

---

## 📈 Monitoring in Production

### Key Metrics to Track

1. **Latency**
   - p50, p95, p99 inference time
   - Alert if >2s regularly

2. **Accuracy**
   - Detection count per frame
   - Filtered vs passed detections ratio
   - False positive rate (user feedback)

3. **Stability**
   - Object tracking persistence
   - Alert flicker rate
   - Session tracking integrity

4. **Errors**
   - Fallback response frequency
   - Inference timeout rate
   - Model load failures

5. **Resource Usage**
   - Memory per session
   - GPU utilization
   - CPU usage

### Logging Commands
```bash
# Watch logs in real-time
tail -f logs/visionmitra.log

# Filter for errors
grep "ERROR" logs/visionmitra.log

# Check inference times
grep "Inference completed" logs/visionmitra.log | awk '{print $NF}'

# Count detections
grep "Detections:" logs/visionmitra.log
```

---

## 🎓 Understanding the Upgrade

### What Changed?
1. **Model**: YOLOv8n (6MB) → YOLOv8m (50MB)
2. **Accuracy**: mAP 37.3% → mAP 50.2%
3. **Inference**: predict() → track()
4. **Image Size**: 640px → 1280px
5. **Preprocessing**: None → CLAHE + Blur
6. **Classes**: 14 → 12 (refined list)
7. **Direction**: 5 zones → 5 zones (refined boundaries)
8. **Distance**: Simple ratio → Ratio + vertical position
9. **Audio**: Basic → Natural language
10. **Edge Cases**: Minimal → Comprehensive

### Why These Changes?
- **Safety First**: More accurate detection = safer navigation
- **Stability**: track() + preprocessing = fewer false alerts
- **Clarity**: Better audio messages = clearer guidance
- **Robustness**: Edge case handling = never crashes

---

## ✅ Acceptance Criteria

System is ready for production when:

1. ✅ Model loads successfully on first run
2. ✅ Inference completes within timeout
3. ✅ All 12 mobility classes detected correctly
4. ✅ Preprocessing applied without errors
5. ✅ Audio messages are clear and natural
6. ✅ Edge cases return fallback responses
7. ✅ Multiple concurrent users supported
8. ✅ No memory leaks over 1000 requests
9. ✅ Logs show all expected information
10. ✅ API responses match expected format

---

## 🎯 Next Steps After Testing

1. **Baseline Performance**
   - Measure current latency
   - Record accuracy metrics
   - Document edge case behavior

2. **Optimize if Needed**
   - GPU acceleration
   - Model quantization
   - Image size tuning

3. **User Testing**
   - Real-world scenarios
   - Various lighting conditions
   - Different environments

4. **Monitor & Iterate**
   - Collect user feedback
   - Analyze failure cases
   - Continuous improvement

---

## 📞 Support

If you encounter issues:

1. Check this guide first
2. Review logs: `backend/logs/`
3. Verify dependencies: `pip list | grep -E "ultralytics|opencv|torch"`
4. Test with minimal example
5. Check YOLOv8 documentation: https://docs.ultralytics.com/

---

**Ready to deploy? Let's go! 🚀**
