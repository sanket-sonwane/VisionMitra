"""
Quick non-GUI detection test using webcam frames.
Captures N frames, sends each to backend, prints full debug report.
No GUI window needed - works with opencv-headless.

Usage: python test_detection_quick.py [num_frames]
"""
import cv2
import base64
import requests
import time
import json
import sys
import numpy as np

BACKEND_URL = "http://localhost:8000"
ENDPOINT = f"{BACKEND_URL}/api/detect-obstacles"
USER_ID = "debug_test_user"
SESSION_ID = "debug_test_session"
NUM_FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 5

# Reuse TCP connection to avoid Windows DNS overhead (~2s per new connection)
http = requests.Session()

def create_realistic_test_frame(idx):
    """Create a test frame with objects YOLO can recognize."""
    frame = np.random.randint(100, 200, (480, 640, 3), dtype=np.uint8)
    
    # Draw person-like shape (rectangle + circle head)
    cv2.rectangle(frame, (200, 150), (300, 450), (50, 50, 200), -1)
    cv2.circle(frame, (250, 120), 40, (50, 50, 200), -1)
    
    # Draw car-like shape
    cv2.rectangle(frame, (400, 250), (600, 400), (200, 50, 50), -1)
    cv2.rectangle(frame, (420, 200), (580, 260), (200, 50, 50), -1)
    cv2.circle(frame, (430, 400), 20, (30, 30, 30), -1)
    cv2.circle(frame, (570, 400), 20, (30, 30, 30), -1)
    
    # Add some texture/noise so proximity detection doesn't think it's a wall
    noise = np.random.randint(-20, 20, frame.shape, dtype=np.int16)
    frame = np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    
    return frame

def try_webcam():
    """Try to open webcam and capture a frame."""
    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        ret, frame = cap.read()
        cap.release()
        if ret and frame is not None:
            return frame, True
    return None, False

def main():
    print("=" * 70)
    print("  VisionMitra Detection Debug - Quick Test")
    print("=" * 70)
    
    # Check backend
    try:
        r = http.get(f"{BACKEND_URL}/api/", timeout=5)
        print(f"Backend: {r.json()}")
    except Exception as e:
        print(f"ERROR: Backend unreachable: {e}")
        sys.exit(1)
    
    # Try webcam
    webcam_frame, has_webcam = try_webcam()
    if has_webcam:
        print(f"Webcam: Available (frame shape: {webcam_frame.shape})")
        source = "webcam"
    else:
        print("Webcam: Not available, using synthetic frames")
        source = "synthetic"
    
    print(f"Testing {NUM_FRAMES} frames from {source}")
    print()
    
    timings = []
    errors = []
    cap = None
    if has_webcam:
        cap = cv2.VideoCapture(0)
        # Let camera warm up
        for _ in range(5):
            cap.read()
    
    for i in range(1, NUM_FRAMES + 1):
        # Get frame
        if cap is not None and cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                frame = create_realistic_test_frame(i)
        else:
            frame = create_realistic_test_frame(i)
        
        # Encode
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 30])
        b64 = base64.b64encode(buffer).decode('utf-8')
        
        print(f"\n{'='*70}")
        print(f"  FRAME {i}/{NUM_FRAMES} | Source: {source} | Image: {frame.shape} | Base64: {len(b64)} chars")
        print(f"{'='*70}")
        
        # Send request
        t0 = time.time()
        try:
            resp = http.post(ENDPOINT, json={
                "image_base64": b64,
                "user_id": USER_ID,
                "session_id": SESSION_ID,
                "include_debug_info": True,
                "include_debug_image": False,
            }, timeout=15)
            elapsed_ms = (time.time() - t0) * 1000
            timings.append(elapsed_ms)
            
            if resp.status_code != 200:
                print(f"  !!! HTTP {resp.status_code}: {resp.text[:200]}")
                errors.append(f"Frame {i}: HTTP {resp.status_code}")
                continue
            
            data = resp.json()
            
            # Response summary
            print(f"  Round-trip     : {elapsed_ms:.0f}ms")
            print(f"  Warning Level  : {data.get('warning_level')}")
            print(f"  Safe Direction : {data.get('safe_direction')}")
            print(f"  Audio Message  : {data.get('audio_message', '')[:80]}")
            print(f"  Has Annotated  : {'YES' if data.get('debug_annotated_image') else 'NO'}")
            ann_len = len(data.get('debug_annotated_image', '') or '')
            if ann_len:
                print(f"  Annotated Size : {ann_len} chars ({ann_len * 3 // 4 // 1024}KB approx)")
            
            # Obstacles
            obstacles = data.get('obstacles', [])
            print(f"\n  Obstacles ({len(obstacles)}):")
            if obstacles:
                for obs in obstacles:
                    print(f"    [{obs.get('object_id','?'):8s}] {obs['type']:15s} "
                          f"dist={obs['distance']:10s} dir={obs['direction']:12s} "
                          f"conf={obs['confidence']:.3f} motion={obs['moving']:12s} "
                          f"frames={obs.get('persistence_frames', '?')}")
            else:
                print(f"    (none)")
            
            # Debug info
            debug = data.get('debug_info', {})
            if debug:
                # Check for errors first
                if debug.get('error'):
                    print(f"\n  !!! PHASE ERROR: {debug['error']} (type: {debug.get('error_type', '?')}) !!!")
                    errors.append(f"Frame {i}: {debug['error']}")
                
                # Phase timings
                print(f"\n  Phase Timings:")
                total_backend = 0
                for key in ['decode_time_ms', 'resize_time_ms', 'model_load_time_ms', 
                             'inference_time_ms', 'parse_time_ms', 'proximity_time_ms',
                             'pipeline_time_ms', 'draw_time_ms']:
                    val = debug.get(key, 'N/A')
                    if isinstance(val, (int, float)):
                        total_backend += val
                    marker = " <<<SLOW" if isinstance(val, (int, float)) and val > 500 else ""
                    print(f"    {key:25s}: {val:>8} ms{marker}")
                print(f"    {'total_time_ms':25s}: {debug.get('total_time_ms', 'N/A'):>8} ms")
                print(f"    {'network_overhead':25s}: {elapsed_ms - (debug.get('total_time_ms', 0) or 0):>8.0f} ms")
                
                # Detection stats
                print(f"\n  Detection Stats:")
                print(f"    YOLO available       : {debug.get('yolo_available')}")
                print(f"    Vision AI enabled    : {debug.get('enable_vision_ai')}")
                print(f"    CV2 available        : {debug.get('cv2_available')}")
                print(f"    Frame shape          : {debug.get('frame_shape')}")
                print(f"    Inference shape      : {debug.get('inference_frame_shape')}")
                print(f"    Total YOLO boxes     : {debug.get('total_yolo_boxes')}")
                print(f"    Mobility filtered    : {debug.get('mobility_filtered_detections')}")
                print(f"    Synthetic injected   : {debug.get('synthetic_detection_injected')}")
                print(f"    Final obstacles      : {debug.get('obstacles_count')}")
                
                # All YOLO detections
                all_dets = debug.get('all_yolo_detections', [])
                if all_dets:
                    print(f"\n  All Raw YOLO Boxes ({len(all_dets)}):")
                    for det in all_dets:
                        mob = "MOB" if det.get('is_mobility_relevant') else "---"
                        print(f"    #{det['idx']:2d} [{mob}] {det['class_name']:20s} "
                              f"conf={det['confidence']:.4f} bbox={det['bbox_px']}")
                else:
                    print(f"\n  All Raw YOLO Boxes: NONE (YOLO detected 0 objects)")
                
                # Proximity
                prox = debug.get('proximity_result', {})
                if prox:
                    print(f"\n  Proximity Analysis:")
                    print(f"    Obstructed   : {prox.get('is_obstructed')}")
                    print(f"    Confidence   : {prox.get('obstruction_confidence')}")
                    print(f"    Reason       : {prox.get('reason')}")
                
                # Pipeline state
                pipe = debug.get('pipeline_debug', {})
                if pipe:
                    print(f"\n  Pipeline State:")
                    print(f"    Total tracked   : {pipe.get('total_objects')}")
                    print(f"    Persistent      : {pipe.get('persistent_objects')}")
                    print(f"    Risk level      : {pipe.get('risk_level')}")
                    for obj in pipe.get('objects', []):
                        print(f"      {obj['id']:8s} {obj['class']:15s} "
                              f"conf={obj['confidence']:.3f} motion={obj['motion']:12s} "
                              f"vis={obj['visibility']} persist={obj['persistence']}")
        
        except requests.exceptions.Timeout:
            elapsed_ms = (time.time() - t0) * 1000
            timings.append(elapsed_ms)
            print(f"  !!! TIMEOUT after {elapsed_ms:.0f}ms")
            errors.append(f"Frame {i}: Timeout")
        except Exception as e:
            elapsed_ms = (time.time() - t0) * 1000
            timings.append(elapsed_ms)
            print(f"  !!! EXCEPTION: {e}")
            errors.append(f"Frame {i}: {e}")
        
        # Small delay between frames
        if i < NUM_FRAMES:
            time.sleep(0.3)
    
    if cap is not None:
        cap.release()
    
    # Summary
    print(f"\n\n{'#'*70}")
    print(f"  FINAL SUMMARY")
    print(f"{'#'*70}")
    print(f"  Frames tested    : {len(timings)}")
    if timings:
        print(f"  Min response     : {min(timings):.0f}ms")
        print(f"  Max response     : {max(timings):.0f}ms")
        print(f"  Average response : {sum(timings)/len(timings):.0f}ms")
        sorted_t = sorted(timings)
        print(f"  Median response  : {sorted_t[len(sorted_t)//2]:.0f}ms")
        if len(timings) > 1:
            print(f"  Std deviation    : {np.std(timings):.0f}ms")
        print(f"  Per-frame times  : {[f'{t:.0f}ms' for t in timings]}")
    
    if errors:
        print(f"\n  ERRORS ({len(errors)}):")
        for err in errors:
            print(f"    - {err}")
    else:
        print(f"\n  No errors detected across all frames!")
    
    print(f"{'#'*70}")

if __name__ == "__main__":
    main()
