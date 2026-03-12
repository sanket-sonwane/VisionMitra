"""
Live webcam detection test script.
Captures frames from webcam, sends to backend /api/detect-obstacles,
measures timing per phase, displays annotated output with bounding boxes.

Usage: python test_live_detection.py
Press 'q' to quit, 's' for single shot, SPACE to toggle continuous.
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

def frame_to_base64(frame):
    """Encode frame to base64 JPEG (mimics what the mobile app sends)."""
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 30])
    return base64.b64encode(buffer).decode('utf-8')

def send_detection_request(frame_b64, frame_num):
    """Send a single detection request and return parsed result with timing."""
    t0 = time.time()
    payload = {
        "image_base64": frame_b64,
        "user_id": USER_ID,
        "session_id": SESSION_ID,
    }
    try:
        resp = requests.post(ENDPOINT, json=payload, timeout=15)
        elapsed = time.time() - t0
        
        if resp.status_code != 200:
            print(f"\n[Frame {frame_num}] HTTP ERROR {resp.status_code}: {resp.text[:200]}")
            return None, elapsed
        
        data = resp.json()
        return data, elapsed
    except requests.exceptions.Timeout:
        elapsed = time.time() - t0
        print(f"\n[Frame {frame_num}] TIMEOUT after {elapsed:.1f}s")
        return None, elapsed
    except Exception as e:
        elapsed = time.time() - t0
        print(f"\n[Frame {frame_num}] ERROR: {e}")
        return None, elapsed

def print_debug_report(data, frame_num, round_trip_ms):
    """Print formatted debug report for a frame."""
    print(f"\n{'='*70}")
    print(f"  FRAME {frame_num} | Round-trip: {round_trip_ms:.0f}ms")
    print(f"{'='*70}")
    
    print(f"  Warning Level : {data.get('warning_level', 'N/A')}")
    print(f"  Safe Direction: {data.get('safe_direction', 'N/A')}")
    print(f"  Audio Message : {data.get('audio_message', 'N/A')[:80]}")
    
    obstacles = data.get('obstacles', [])
    print(f"  Obstacles ({len(obstacles)}):")
    for obs in obstacles:
        print(f"    - {obs['type']:15s} | dist={obs['distance']:10s} | dir={obs['direction']:12s} "
              f"| conf={obs['confidence']:.3f} | motion={obs['moving']:12s} | frames={obs.get('persistence_frames', '?')}")
    
    debug = data.get('debug_info')
    if debug:
        print(f"\n  --- Phase Timings ---")
        for key in ['decode_time_ms', 'resize_time_ms', 'model_load_time_ms', 
                     'inference_time_ms', 'parse_time_ms', 'proximity_time_ms',
                     'pipeline_time_ms', 'draw_time_ms', 'total_time_ms']:
            val = debug.get(key, 'N/A')
            print(f"    {key:25s}: {val} ms")
        
        print(f"\n  --- Detection Stats ---")
        print(f"    YOLO available       : {debug.get('yolo_available', 'N/A')}")
        print(f"    Enable Vision AI     : {debug.get('enable_vision_ai', 'N/A')}")
        print(f"    CV2 available        : {debug.get('cv2_available', 'N/A')}")
        print(f"    Frame shape          : {debug.get('frame_shape', 'N/A')}")
        print(f"    Inference frame      : {debug.get('inference_frame_shape', 'N/A')}")
        print(f"    Total YOLO boxes     : {debug.get('total_yolo_boxes', 'N/A')}")
        print(f"    Mobility filtered    : {debug.get('mobility_filtered_detections', 'N/A')}")
        print(f"    Synthetic injected   : {debug.get('synthetic_detection_injected', 'N/A')}")
        print(f"    Obstacles reported   : {debug.get('obstacles_count', 'N/A')}")
        
        all_dets = debug.get('all_yolo_detections', [])
        if all_dets:
            print(f"\n  --- ALL Raw YOLO Detections ({len(all_dets)}) ---")
            for det in all_dets:
                mob = "YES" if det.get('is_mobility_relevant') else "NO "
                print(f"    #{det['idx']:2d} {det['class_name']:20s} conf={det['confidence']:.4f} "
                      f"mob={mob} bbox={det['bbox_px']}")
        
        proximity = debug.get('proximity_result')
        if proximity:
            print(f"\n  --- Proximity Analysis ---")
            print(f"    Obstructed: {proximity.get('is_obstructed')}, "
                  f"Confidence: {proximity.get('obstruction_confidence')}, "
                  f"Reason: {proximity.get('reason')}")
        
        pipeline = debug.get('pipeline_debug')
        if pipeline:
            print(f"\n  --- Pipeline State ---")
            print(f"    Total objects    : {pipeline.get('total_objects', 'N/A')}")
            print(f"    Persistent       : {pipeline.get('persistent_objects', 'N/A')}")
            print(f"    Risk level       : {pipeline.get('risk_level', 'N/A')}")
            for obj in pipeline.get('objects', []):
                print(f"      {obj['id']:8s} {obj['class']:15s} conf={obj['confidence']:.3f} "
                      f"motion={obj['motion']:12s} vis={obj['visibility']} persist={obj['persistence']}")

        # Check for errors
        if debug.get('error'):
            print(f"\n  !!! ERROR DETECTED: {debug['error']} !!!")
    
    print(f"{'='*70}\n")

def show_annotated_image(data, original_frame):
    """Display the annotated image from backend, or fallback to original frame."""
    annotated_b64 = data.get('debug_annotated_image')
    if annotated_b64:
        img_bytes = base64.b64decode(annotated_b64)
        np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
        annotated = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if annotated is not None:
            # Scale up for visibility
            h, w = annotated.shape[:2]
            scale = max(1, 640 // max(w, 1))
            if scale > 1:
                annotated = cv2.resize(annotated, (w * scale, h * scale), interpolation=cv2.INTER_NEAREST)
            cv2.imshow("Detection Debug - Annotated", annotated)
            return
    # Fallback
    cv2.imshow("Detection Debug - Annotated", original_frame)

def main():
    print("=" * 60)
    print("  VisionMitra Live Detection Debug Test")
    print("=" * 60)
    print("Controls:")
    print("  SPACE = toggle continuous mode")
    print("  s     = single shot analysis")
    print("  q     = quit")
    print()
    
    # Check backend health
    try:
        r = requests.get(f"{BACKEND_URL}/api/", timeout=5)
        print(f"Backend status: {r.json()}")
    except Exception as e:
        print(f"ERROR: Cannot reach backend at {BACKEND_URL}: {e}")
        print("Make sure server is running: cd backend && python -m uvicorn server:app --port 8000")
        sys.exit(1)
    
    # Open webcam
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: Cannot open webcam (index 0)")
        # Try with a static test image instead
        print("Falling back to synthetic test image...")
        cap = None
    
    continuous = False
    frame_num = 0
    timings = []
    
    print("\nReady! Press 's' for single analysis or SPACE for continuous.\n")
    
    while True:
        if cap is not None:
            ret, frame = cap.read()
            if not ret:
                print("Webcam read failed, retrying...")
                time.sleep(0.5)
                continue
        else:
            # Generate synthetic test frame with shapes
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            # Draw some "obstacles" for YOLO to detect
            cv2.rectangle(frame, (100, 100), (300, 400), (0, 0, 255), -1)  # Red box
            cv2.circle(frame, (450, 250), 80, (0, 255, 0), -1)  # Green circle
            cv2.putText(frame, f"Synthetic Frame {frame_num}", (50, 50), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        
        # Show live feed
        display = frame.copy()
        status = "CONTINUOUS" if continuous else "PAUSED"
        color = (0, 255, 0) if continuous else (0, 165, 255)
        cv2.putText(display, f"[{status}] Frame {frame_num} | Press 's' or SPACE", 
                   (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        if timings:
            avg = sum(timings[-10:]) / len(timings[-10:])
            cv2.putText(display, f"Avg response: {avg:.0f}ms (last 10)", 
                       (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)
        cv2.imshow("Detection Debug - Live Feed", display)
        
        # Process key
        key = cv2.waitKey(1 if continuous else 50) & 0xFF
        
        if key == ord('q'):
            break
        elif key == ord('s'):
            # Single shot
            frame_num += 1
            b64 = frame_to_base64(frame)
            print(f"\n>>> Sending frame {frame_num} ({len(b64)} bytes base64)...")
            data, elapsed = send_detection_request(b64, frame_num)
            elapsed_ms = elapsed * 1000
            timings.append(elapsed_ms)
            if data:
                print_debug_report(data, frame_num, elapsed_ms)
                show_annotated_image(data, frame)
            else:
                print(f"No response data for frame {frame_num}")
        elif key == ord(' '):
            continuous = not continuous
            print(f"\n{'>>> CONTINUOUS MODE ON' if continuous else '>>> CONTINUOUS MODE OFF'}")
        
        if continuous:
            frame_num += 1
            b64 = frame_to_base64(frame)
            data, elapsed = send_detection_request(b64, frame_num)
            elapsed_ms = elapsed * 1000
            timings.append(elapsed_ms)
            if data:
                print_debug_report(data, frame_num, elapsed_ms)
                show_annotated_image(data, frame)
                
                # Check for errors in any phase
                debug = data.get('debug_info', {})
                if debug.get('error'):
                    print(f"\n!!! ERROR in frame {frame_num}: {debug['error']}")
                    continuous = False
                    print("Stopped continuous mode due to error.")
    
    # Summary
    if timings:
        print(f"\n{'='*60}")
        print(f"  Test Summary")
        print(f"{'='*60}")
        print(f"  Frames analyzed  : {len(timings)}")
        print(f"  Min response     : {min(timings):.0f}ms")
        print(f"  Max response     : {max(timings):.0f}ms")
        print(f"  Average response : {sum(timings)/len(timings):.0f}ms")
        print(f"  Median response  : {sorted(timings)[len(timings)//2]:.0f}ms")
        if len(timings) > 1:
            print(f"  Std deviation    : {np.std(timings):.0f}ms")
        print(f"{'='*60}")
    
    if cap is not None:
        cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
