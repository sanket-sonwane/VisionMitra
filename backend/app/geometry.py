"""Single source of truth for converting a normalized detection box into a
human-readable direction and distance.

Detection boxes are normalized to the `0.0 - 1.0` range (see `geometry` usage
below and `vision.inference`), so both helpers take ratios, not pixels. This
module intentionally keeps the thresholds in one place so the detection router
and the temporal risk engine always agree.
"""

from __future__ import annotations

from typing import Literal

Direction = Literal["left", "front-left", "front", "front-right", "right"]
Distance = Literal["immediate", "near", "far"]

# Horizontal position thresholds (fraction of frame width).
_LEFT_MAX = 0.25
_FRONT_LEFT_MAX = 0.42
_FRONT_RIGHT_MIN = 0.58
_RIGHT_MIN = 0.75

# Box-area thresholds (fraction of total frame area).
_IMMEDIATE_AREA = 0.24
_NEAR_AREA = 0.08


def classify_direction(center_x_ratio: float) -> Direction:
    """Map a normalized box-center x (0..1) to a relative direction."""
    if center_x_ratio < _LEFT_MAX:
        return "left"
    if center_x_ratio < _FRONT_LEFT_MAX:
        return "front-left"
    if center_x_ratio <= _FRONT_RIGHT_MIN:
        return "front"
    if center_x_ratio <= _RIGHT_MIN:
        return "front-right"
    return "right"


def classify_distance(area_ratio: float) -> Distance:
    """Map a normalized box area (0..1) to a coarse distance bucket."""
    if area_ratio >= _IMMEDIATE_AREA:
        return "immediate"
    if area_ratio >= _NEAR_AREA:
        return "near"
    return "far"
