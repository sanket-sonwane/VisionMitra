# Dete-Opt Architecture (Low-Latency Corridor Guidance)

## Why This Design
The app should prioritize hazards inside the blind user's intended walking corridor, while still reporting side traffic as caution context.

## Real-Time Pipeline
1. Camera capture
- Request smallest practical native picture size (prefer 640x480 to 1280x720).
- Keep `skipProcessing=true` and low EXIF overhead.

2. Fast decode
- Use `Buffer.from(base64, "base64")` for byte conversion.
- Decode once and downsample to model size.

3. Perception
- YOLOv8n object detections.
- Scene proximity detector for wall/flat-surface fallback.

4. Corridor-aware risk engine
- Define a trapezoid corridor (narrow at top, wider at bottom).
- For each persistent object, compute horizontal overlap with corridor.
- Classify lane as `path`, `left`, `right`, or `edge`.

5. Decision policy
- `path` / `edge` + near/immediate => danger decisions (turn/stop guidance).
- `left` / `right` objects => caution context (no forced turn unless path is blocked).
- Side-only traffic should not trigger unnecessary zig-zag commands.

## Corridor Geometry (Normalized)
- Top Y: 0.20
- Top bounds: [0.44, 0.56]
- Bottom bounds: [0.26, 0.74]
- Path overlap threshold: >= 0.35 => in-path obstacle

## Alert Semantics
- CRITICAL: immediate in-path hazard and both sides risky -> stop.
- DANGER: in-path immediate/near/approaching -> choose lower-threat side.
- CAUTION: side-lane hazards only -> keep centered.
- SAFE: no persistent hazards.

## Latency Budget Target
- Capture: <= 600 ms
- Decode + preprocess: <= 300 ms
- Inference + scene + pipeline: <= 900 ms
- End-to-end: <= 1.8 s (continuous mode), with no per-frame resize in normal flow.

## Optimization Rules
- Avoid running `ImageManipulator` every frame.
- Resize only as a fallback for oversized frames (>1.2MB base64).
- Keep telemetry visible for capture/decode/inference so regressions are obvious.

## Next Production Enhancements
- Use camera preview frame processing (no full still capture loop) for sub-second guidance.
- Add temporal smoothing for safe-direction commands to reduce command churn.
- Add confidence decay for stale tracked objects to prevent ghost alerts.
