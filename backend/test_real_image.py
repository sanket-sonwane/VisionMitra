"""Quick test: send a real street-scene image to the detection endpoint."""
import json, base64, cv2, requests, urllib.request, os, numpy as np

# Download a real street scene (ultralytics sample)
img_path = "test_bus.jpg"
if not os.path.exists(img_path):
    print("Downloading test image...")
    urllib.request.urlretrieve("https://ultralytics.com/images/bus.jpg", img_path)

img = cv2.imread(img_path)
print(f"Image shape: {img.shape}")

_, buf = cv2.imencode(".jpg", img)
b64 = base64.b64encode(buf).decode()
print(f"Base64 length: {len(b64)}")

r = requests.post(
    "http://127.0.0.1:8000/api/detect-obstacles",
    json={"image_base64": b64, "user_id": "test", "session_id": "real_test"},
    timeout=120,
)
result = r.json()
print(f"Status: {r.status_code}")
print(f"Warning: {result.get('warning_level')}")
print(f"Audio: {result.get('audio_message')}")
print(f"Obstacles: {len(result.get('obstacles', []))}")
for o in result.get("obstacles", []):
    t = o.get("type")
    c = o.get("confidence")
    d = o.get("distance")
    dr = o.get("direction")
    m = o.get("moving")
    print(f"  {t} | conf={c} | dist={d} | dir={dr} | moving={m}")
print(f"Safe direction: {result.get('safe_direction')}")
