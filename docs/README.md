# VisionMitra Documentation

Start with the root [`../README.md`](../README.md) for the system overview and
the canonical technical reference.

## Canonical documents

| Document | Contents |
| --- | --- |
| [`detection-pipeline.md`](./detection-pipeline.md) | End-to-end obstacle detection data flow (capture → YOLO → spatial classification → audio). |
| [`robust-detection.md`](./robust-detection.md) | Temporal tracking, confidence smoothing, hysteresis, and fail-safe design. |
| [`journey-planner.md`](./journey-planner.md) | Journey planning algorithm, data models, caching, and fallbacks. |
| [`journey-planner-quickstart.md`](./journey-planner-quickstart.md) | Developer/end-user quick start for the journey planner. |
| [`system-architecture.md`](./system-architecture.md) | System-level and segment-execution flow diagrams. |
| [`technical-spec.md`](./technical-spec.md) | API endpoint reference and MongoDB schema design. |
| [`../SETUP.md`](../SETUP.md) | Team setup guide (backend + frontend). |

## Historical / implementation reports

The files in [`history/`](./history/) are point-in-time implementation summaries
and internal notes retained for reference. They may describe earlier designs and
are **not** guaranteed to match the current code. Prefer the canonical documents
above and the source itself.

- `IMPLEMENTATION_COMPLETE.md`, `README_UPDATED.md`, `EYE_GUIDE_README.md`
- `ROBUST_PIPELINE_ARCHITECTURE.md`, `ROBUST_PIPELINE_DELIVERY.md`, `ROBUST_PIPELINE_IMPLEMENTATION.md`
- `SOS_IMPLEMENTATION_SUMMARY.md`
- `test_result.md`, `image_testing.md`
