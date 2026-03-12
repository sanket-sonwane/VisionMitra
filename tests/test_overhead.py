"""Isolate where the ~2s network overhead lives."""
import requests, time, base64, sys
URL = "http://localhost:8000"

# Test 1: Minimal GET
t0 = time.time()
r = requests.get(f"{URL}/api/")
print(f"GET /api/ .............. {(time.time()-t0)*1000:.0f}ms", flush=True)

# Test 2: POST with tiny (invalid) image
t0 = time.time()
r = requests.post(f"{URL}/api/detect-obstacles", json={
    "image_base64": "AAAA", "user_id": "test", "session_id": "test"
}, timeout=10)
print(f"POST tiny image ........ {(time.time()-t0)*1000:.0f}ms (status={r.status_code})", flush=True)

# Test 3: Reuse connection with Session
s = requests.Session()
_ = s.get(f"{URL}/api/")
t0 = time.time()
r = s.post(f"{URL}/api/detect-obstacles", json={
    "image_base64": "AAAA", "user_id": "test", "session_id": "test"
}, timeout=10)
print(f"POST Session (warm) .... {(time.time()-t0)*1000:.0f}ms (status={r.status_code})", flush=True)

# Test 4: Real image
import cv2
cap = cv2.VideoCapture(0)
for _ in range(3): cap.read()
ret, frame = cap.read()
cap.release()
_, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 30])
b64 = base64.b64encode(buf).decode()
print(f"\nImage size: {len(b64)} chars base64", flush=True)

# First real request (model cold if not warmed)
t0 = time.time()
r = s.post(f"{URL}/api/detect-obstacles", json={
    "image_base64": b64, "user_id": "test", "session_id": "test"
}, timeout=15)
print(f"POST real img (1st) .... {(time.time()-t0)*1000:.0f}ms  resp={len(r.content)}b", flush=True)

# Rapid-fire 5x with Session
times = []
for i in range(5):
    t0 = time.time()
    r = s.post(f"{URL}/api/detect-obstacles", json={
        "image_base64": b64, "user_id": "test", "session_id": "test"
    }, timeout=15)
    t = (time.time()-t0)*1000
    times.append(t)
    print(f"POST rapid #{i+1} .......... {t:.0f}ms  resp={len(r.content)}b", flush=True)

# With debug_info to get server timing
t0 = time.time()
r = s.post(f"{URL}/api/detect-obstacles", json={
    "image_base64": b64, "user_id": "test", "session_id": "test",
    "include_debug_info": True
}, timeout=15)
elapsed = (time.time()-t0)*1000
data = r.json()
di = data.get("debug_info") or {}
st = di.get("total_time_ms", "?")
print(f"\nWith debug_info:  RT={elapsed:.0f}ms  server={st}ms  resp={len(r.content)}b", flush=True)
if isinstance(st, (int, float)):
    print(f"  network_overhead = {elapsed - st:.0f}ms", flush=True)

# Summary
print(f"\n--- RAPID-FIRE SUMMARY ---", flush=True)
print(f"Min: {min(times):.0f}ms  Max: {max(times):.0f}ms  Avg: {sum(times)/len(times):.0f}ms", flush=True)
