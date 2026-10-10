"""Unit tests for normalized direction/distance classification."""

from __future__ import annotations

import pytest
from app.geometry import classify_direction, classify_distance


@pytest.mark.parametrize(
    ("center_x", "expected"),
    [
        (0.0, "left"),
        (0.24, "left"),
        (0.25, "front-left"),
        (0.41, "front-left"),
        (0.42, "front"),
        (0.5, "front"),
        (0.58, "front"),
        (0.59, "front-right"),
        (0.75, "front-right"),
        (0.76, "right"),
        (1.0, "right"),
    ],
)
def test_classify_direction(center_x, expected):
    assert classify_direction(center_x) == expected


@pytest.mark.parametrize(
    ("area", "expected"),
    [
        (0.0, "far"),
        (0.079, "far"),
        (0.08, "near"),
        (0.239, "near"),
        (0.24, "immediate"),
        (0.9, "immediate"),
    ],
)
def test_classify_distance(area, expected):
    assert classify_distance(area) == expected
