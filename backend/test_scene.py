"""Quick end-to-end test for scene + YOLO detection."""
import requests, base64, time, urllib.request

urllib.request.urlretrieve("https://ultralytics.com/images/bus.jpg", "test_bus.jpg")
with open("test_bus.jpg", "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode()

requests.post("http://localhost:8000/api/detection-pipeline/clear/test_scene")

t0 = time.time()
resp = requests.post("http://localhost:8000/api/detect-obstacles", json={
    "image_base64": img_b64,
    "user_id": "test_user",
    "session_id": "test_scene",
}, timeout=30)
elapsed = time.time() - t0

data = resp.json()
print(f"Response in {elapsed:.2f}s, status={resp.status_code}")
print(f"Warning: {data['warning_level']}")
print(f"Direction: {data['safe_direction']}")
print(f"Audio: {data['audio_message']}")
print(f"Scene: {data.get('scene_type', 'N/A')}")
print(f"Scene Desc: {data.get('scene_description', 'N/A')}")
print(f"Path: {data.get('path_status', 'N/A')}")
print(f"Wall: {data.get('wall_ahead', 'N/A')} ({data.get('wall_distance', 'N/A')})")
print(f"Ground: {data.get('ground_type', 'N/A')}")
print(f"Road edges: {data.get('road_edges', 'N/A')}")
print(f"Nav guidance: {data.get('navigation_guidance', 'N/A')}")
print(f"Obstacles: {len(data['obstacles'])}")
for o in data["obstacles"]:
    print(f"  - {o['type']} ({o['confidence']}) {o['distance']} {o['direction']} {o['moving']}")

# Frame 2
print("\n--- Frame 2 ---")
t0 = time.time()
resp2 = requests.post("http://localhost:8000/api/detect-obstacles", json={
    "image_base64": img_b64,
    "user_id": "test_user",
    "session_id": "test_scene",
}, timeout=30)
elapsed2 = time.time() - t0
d2 = resp2.json()
print(f"Response in {elapsed2:.2f}s")
print(f"Warning: {d2['warning_level']}")
print(f"Audio: {d2['audio_message']}")
print(f"Scene: {d2.get('scene_type', 'N/A')}")
print(f"Obstacles: {len(d2['obstacles'])}")
for o in d2["obstacles"]:
    print(f"  - {o['type']} ({o['confidence']}) {o['distance']} {o['direction']} {o['moving']}")
