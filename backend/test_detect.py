import requests, base64, json, time

API = 'http://127.0.0.1:8000'

# Clear any old pipeline state
try:
    requests.post(f'{API}/api/detection-pipeline/clear/test_stream', timeout=5)
except:
    pass

# Download a test image
img_url = 'https://ultralytics.com/images/bus.jpg'
print('Downloading test image...')
img_data = requests.get(img_url, timeout=15).content
b64 = base64.b64encode(img_data).decode('utf-8')
print(f'Image size: {len(img_data)} bytes, base64 len: {len(b64)}')

# Simulate streaming: send SAME image 5 times rapidly (like live camera)
print('\n=== Simulating 5-frame live stream ===')
for i in range(5):
    start = time.time()
    resp = requests.post(f'{API}/api/detect-obstacles', json={
        'image_base64': b64,
        'user_id': 'test_user',
        'session_id': 'test_stream',
        'latitude': None,
        'longitude': None,
    }, timeout=30)
    elapsed = time.time() - start
    data = resp.json()
    obstacles = data.get('obstacles', [])
    print(f'\nFrame {i+1}: status={resp.status_code} time={elapsed:.2f}s')
    print(f'  warning_level={data.get("warning_level")}')
    print(f'  audio_message={data.get("audio_message")}')
    print(f'  obstacles count={len(obstacles)}')
    print(f'  detection_count={data.get("detection_count")}')
    print(f'  filtered_count={data.get("filtered_count")}')
    print(f'  frame_size={data.get("frame_size")}')
    for obs in obstacles:
        print(f'    - type={obs.get("type")} conf={obs.get("confidence")} '
              f'distance={obs.get("distance")} direction={obs.get("direction")} '
              f'moving={obs.get("moving")} persistence={obs.get("persistence_frames")}')
    if not obstacles:
        print(f'    (NO obstacles in response)')

    # Small delay to avoid throttle (<500ms guard in server)
    time.sleep(0.1)

# Also check debug info
print('\n=== Pipeline Debug ===')
resp = requests.get(f'{API}/api/detection-pipeline/debug/test_stream', timeout=5)
print(json.dumps(resp.json(), indent=2))
