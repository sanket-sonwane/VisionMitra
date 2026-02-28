"""
Scene Analyzer for Blind Navigation System.

Uses OpenCV computer vision to understand scene context that YOLO cannot:
- Environment type (indoor room, outdoor road, corridor, open space)
- Wall/large surface detection (uniform texture ahead)
- Road edge and boundary detection
- Walkable path analysis (ground plane, free space ahead)
- Spatial zone blockage (left/center/right)

This runs alongside YOLO to provide comprehensive scene understanding
like a sighted guide would give a blind person.
"""

import cv2
import numpy as np
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Tuple, Optional, Dict

logger = logging.getLogger(__name__)


class EnvironmentType(str, Enum):
    INDOOR_ROOM = "indoor_room"
    INDOOR_CORRIDOR = "indoor_corridor"
    OUTDOOR_ROAD = "outdoor_road"
    OUTDOOR_SIDEWALK = "outdoor_sidewalk"
    OUTDOOR_OPEN = "outdoor_open"
    STAIRWAY = "stairway"
    UNKNOWN = "unknown"


class SurfaceType(str, Enum):
    WALL = "wall"
    FLOOR = "floor"
    ROAD = "road"
    GRASS = "grass"
    SKY = "sky"
    UNKNOWN = "unknown"


class PathStatus(str, Enum):
    CLEAR = "clear"
    PARTIALLY_BLOCKED = "partially_blocked"
    BLOCKED = "blocked"
    WALL_AHEAD = "wall_ahead"
    EDGE_NEARBY = "edge_nearby"
    NO_PATH = "no_path"


@dataclass
class ZoneAnalysis:
    """Analysis of one spatial zone (left/center/right)"""
    zone: str  # "left", "center", "right"
    edge_density: float  # 0-1, how many edges in this zone
    avg_depth_hint: float  # 0-1, estimated relative depth (higher = closer)
    has_obstacle: bool
    has_wall: bool
    is_walkable: bool
    dominant_color: str  # rough color description


@dataclass
class SceneAnalysisResult:
    """Complete scene analysis result"""
    environment: EnvironmentType
    environment_confidence: float  # 0-1

    # Path analysis
    path_status: PathStatus
    path_direction: str  # "forward", "left", "right", "none"
    walkable_ratio: float  # 0-1, fraction of lower frame that is walkable

    # Wall/surface detection
    wall_ahead: bool
    wall_distance_hint: str  # "immediate", "near", "far", "none"
    wall_direction: str  # "center", "left", "right", "none"

    # Road/boundary
    road_edges_detected: bool
    left_boundary: bool  # is there a boundary on the left
    right_boundary: bool  # is there a boundary on the right
    road_direction_hint: str  # where the road leads: "straight", "curves_left", "curves_right"

    # Spatial zones
    zones: List[ZoneAnalysis] = field(default_factory=list)

    # Ground plane
    ground_visible: bool = True
    ground_type: str = "unknown"  # "pavement", "tile", "grass", "dirt", "carpet"

    # Scene description for audio
    scene_description: str = ""
    navigation_guidance: str = ""

    # Debug
    analysis_time_ms: float = 0.0


class SceneAnalyzer:
    """
    OpenCV-based scene understanding for blind navigation.

    Fast enough to run on every frame on CPU (~10-30ms).
    Provides environment awareness that object detection cannot.
    """

    # Color ranges for surface classification (HSV)
    # Road/pavement: grey tones
    ROAD_HSV_LOW = np.array([0, 0, 40])
    ROAD_HSV_HIGH = np.array([180, 60, 180])
    # Grass: green tones
    GRASS_HSV_LOW = np.array([30, 30, 30])
    GRASS_HSV_HIGH = np.array([90, 255, 255])
    # Sky: blue-ish with low saturation
    SKY_HSV_LOW = np.array([90, 20, 150])
    SKY_HSV_HIGH = np.array([140, 255, 255])

    def __init__(self):
        self._prev_gray = None  # for optical flow
        self._frame_count = 0
        self._env_history: List[EnvironmentType] = []  # temporal smoothing

    def analyze(self, frame: np.ndarray) -> SceneAnalysisResult:
        """
        Main entry point. Analyze a single frame for scene understanding.

        Args:
            frame: BGR image (OpenCV format)

        Returns:
            SceneAnalysisResult with full scene analysis
        """
        import time as _time
        t0 = _time.time()

        h, w = frame.shape[:2]
        self._frame_count += 1

        # Convert to useful formats
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # 1. Detect edges globally
        edges = cv2.Canny(gray, 50, 150)

        # 2. Analyze spatial zones (left / center / right)
        zones = self._analyze_zones(frame, gray, hsv, edges, h, w)

        # 3. Detect walls/large uniform surfaces
        wall_ahead, wall_dist, wall_dir = self._detect_walls(gray, edges, h, w)

        # 4. Detect road edges and boundaries
        road_info = self._detect_road_boundaries(gray, edges, hsv, h, w)

        # 5. Analyze walkable ground plane
        ground_info = self._analyze_ground_plane(frame, hsv, edges, h, w)

        # 6. Classify environment
        env_type, env_conf = self._classify_environment(
            gray, hsv, edges, zones, wall_ahead, road_info, ground_info, h, w
        )

        # 7. Determine path status
        path_status, path_dir = self._determine_path_status(
            zones, wall_ahead, wall_dir, road_info, ground_info
        )

        # 8. Generate navigation guidance
        scene_desc, nav_guidance = self._generate_guidance(
            env_type, path_status, path_dir, wall_ahead, wall_dist, wall_dir,
            road_info, ground_info, zones
        )

        elapsed = (_time.time() - t0) * 1000

        # Temporal smoothing for environment
        self._env_history.append(env_type)
        if len(self._env_history) > 5:
            self._env_history.pop(0)
        # Use most common recent environment
        env_counts: Dict[EnvironmentType, int] = {}
        for e in self._env_history:
            env_counts[e] = env_counts.get(e, 0) + 1
        smoothed_env = max(env_counts, key=env_counts.get)

        self._prev_gray = gray

        return SceneAnalysisResult(
            environment=smoothed_env,
            environment_confidence=env_conf,
            path_status=path_status,
            path_direction=path_dir,
            walkable_ratio=ground_info.get("walkable_ratio", 0.0),
            wall_ahead=wall_ahead,
            wall_distance_hint=wall_dist,
            wall_direction=wall_dir,
            road_edges_detected=road_info.get("edges_found", False),
            left_boundary=road_info.get("left_boundary", False),
            right_boundary=road_info.get("right_boundary", False),
            road_direction_hint=road_info.get("direction", "straight"),
            zones=zones,
            ground_visible=ground_info.get("visible", True),
            ground_type=ground_info.get("type", "unknown"),
            scene_description=scene_desc,
            navigation_guidance=nav_guidance,
            analysis_time_ms=round(elapsed, 1),
        )

    # ======================== ZONE ANALYSIS ========================

    def _analyze_zones(
        self, frame, gray, hsv, edges, h, w
    ) -> List[ZoneAnalysis]:
        """Divide frame into left/center/right zones and analyze each."""
        zones = []
        third = w // 3
        zone_names = ["left", "center", "right"]

        for i, name in enumerate(zone_names):
            x_start = i * third
            x_end = (i + 1) * third if i < 2 else w

            zone_gray = gray[:, x_start:x_end]
            zone_edges = edges[:, x_start:x_end]
            zone_hsv = hsv[:, x_start:x_end]

            # Edge density: fraction of edge pixels
            edge_density = float(np.count_nonzero(zone_edges)) / max(zone_edges.size, 1)

            # Depth hint from texture: more texture variance = closer
            # Use Laplacian variance as depth proxy
            laplacian = cv2.Laplacian(zone_gray, cv2.CV_64F)
            texture_var = float(laplacian.var())
            # Normalize: high variance (>1000) = very close, low (<100) = far
            depth_hint = min(1.0, texture_var / 1500.0)

            # Check for wall: low edge density in center region + uniform color
            zone_lower = zone_gray[h // 2:, :]  # bottom half of zone
            color_std = float(np.std(zone_lower))
            has_wall = (color_std < 30 and edge_density < 0.03 and depth_hint > 0.2)

            # Check if walkable: bottom portion should have ground-like colors
            zone_bottom_hsv = zone_hsv[int(h * 0.7):, :]
            walkable = self._is_ground_region(zone_bottom_hsv)

            # Dominant color description
            dom_color = self._describe_dominant_color(zone_hsv)

            # Has obstacle: high edge density in a concentrated area
            # Threshold raised to avoid false positives in busy outdoor scenes
            has_obstacle = (edge_density > 0.15 and depth_hint > 0.5) or (has_wall and depth_hint > 0.3)

            zones.append(ZoneAnalysis(
                zone=name,
                edge_density=round(edge_density, 4),
                avg_depth_hint=round(depth_hint, 3),
                has_obstacle=has_obstacle,
                has_wall=has_wall,
                is_walkable=walkable,
                dominant_color=dom_color,
            ))

        return zones

    # ======================== WALL DETECTION ========================

    def _detect_walls(self, gray, edges, h, w) -> Tuple[bool, str, str]:
        """
        Detect if there's a wall or large flat surface ahead.

        A wall typically shows:
        - Low edge density in the center
        - Very uniform color/texture
        - High Laplacian focus (in-focus uniform surface = close)

        Returns:
            (wall_ahead, distance_hint, direction)
        """
        # Focus on center region (where user is walking toward)
        center_x1 = w // 4
        center_x2 = 3 * w // 4
        center_y1 = h // 4
        center_y2 = 3 * h // 4

        center_gray = gray[center_y1:center_y2, center_x1:center_x2]
        center_edges = edges[center_y1:center_y2, center_x1:center_x2]

        # Metrics for wall detection
        center_edge_density = float(np.count_nonzero(center_edges)) / max(center_edges.size, 1)
        color_std = float(np.std(center_gray))
        color_mean = float(np.mean(center_gray))

        # Laplacian for texture/focus
        lap = cv2.Laplacian(center_gray, cv2.CV_64F)
        lap_var = float(lap.var())

        # Histogram uniformity: a wall has a narrow histogram peak
        hist = cv2.calcHist([center_gray], [0], None, [32], [0, 256])
        hist_norm = hist / max(hist.sum(), 1)
        hist_max = float(hist_norm.max())  # high peak = uniform

        # Wall scoring
        wall_score = 0.0

        # Low edge density in center = likely flat surface
        if center_edge_density < 0.02:
            wall_score += 0.35
        elif center_edge_density < 0.04:
            wall_score += 0.15

        # Uniform color (low std dev)
        if color_std < 20:
            wall_score += 0.30
        elif color_std < 35:
            wall_score += 0.15

        # Dominant histogram peak (uniform surface)
        if hist_max > 0.25:
            wall_score += 0.20
        elif hist_max > 0.15:
            wall_score += 0.10

        # Some texture variance (in-focus surface, not blank sky)
        if 50 < lap_var < 2000:
            wall_score += 0.15

        wall_ahead = wall_score >= 0.50

        # Distance hint from coverage + texture
        if wall_ahead:
            # Check how much of the full frame is this uniform surface
            full_std = float(np.std(gray))
            if full_std < 25:
                dist = "immediate"  # whole frame is wall
            elif color_std < 15 and lap_var > 200:
                dist = "immediate"
            elif color_std < 25:
                dist = "near"
            else:
                dist = "far"

            # Direction: check if wall is more left or right
            left_std = float(np.std(gray[center_y1:center_y2, :w // 2]))
            right_std = float(np.std(gray[center_y1:center_y2, w // 2:]))
            if left_std < 25 and right_std < 25:
                direction = "center"
            elif left_std < right_std:
                direction = "left"
            elif right_std < left_std:
                direction = "right"
            else:
                direction = "center"
        else:
            dist = "none"
            direction = "none"

        return wall_ahead, dist, direction

    # ======================== ROAD BOUNDARY DETECTION ========================

    def _detect_road_boundaries(self, gray, edges, hsv, h, w) -> Dict:
        """
        Detect road edges and boundaries using Hough lines.

        Looks for:
        - Converging lines (road edges)
        - Vanishing point (road direction)
        - Road surface vs non-road boundaries
        """
        result = {
            "edges_found": False,
            "left_boundary": False,
            "right_boundary": False,
            "direction": "straight",
            "vanishing_point": None,
        }

        # Focus on lower 60% of frame (where road would be)
        road_region = edges[int(h * 0.4):, :]
        road_h, road_w = road_region.shape[:2]

        # Hough line detection
        lines = cv2.HoughLinesP(
            road_region,
            rho=1,
            theta=np.pi / 180,
            threshold=50,
            minLineLength=road_h // 4,
            maxLineGap=20,
        )

        if lines is None or len(lines) < 2:
            return result

        result["edges_found"] = True

        # Classify lines as left-edge or right-edge based on angle and position
        left_lines = []
        right_lines = []

        for line in lines:
            x1, y1, x2, y2 = line[0]
            if x2 == x1:
                continue
            slope = (y2 - y1) / (x2 - x1 + 1e-6)
            mid_x = (x1 + x2) / 2

            # Filter near-horizontal lines (not road edges)
            if abs(slope) < 0.3:
                continue

            if mid_x < road_w / 2 and slope < 0:
                left_lines.append((x1, y1, x2, y2, slope))
            elif mid_x > road_w / 2 and slope > 0:
                right_lines.append((x1, y1, x2, y2, slope))

        result["left_boundary"] = len(left_lines) >= 1
        result["right_boundary"] = len(right_lines) >= 1

        # Estimate vanishing point from line intersections
        if left_lines and right_lines:
            # Average slopes
            avg_left_slope = np.mean([l[4] for l in left_lines])
            avg_right_slope = np.mean([l[4] for l in right_lines])

            # Rough vanishing point x
            vp_x_ratio = 0.5  # default center
            if abs(avg_left_slope) > 0.1 and abs(avg_right_slope) > 0.1:
                # Compare slopes to determine curve
                slope_diff = avg_right_slope + avg_left_slope
                if slope_diff > 0.3:
                    result["direction"] = "curves_right"
                elif slope_diff < -0.3:
                    result["direction"] = "curves_left"
                else:
                    result["direction"] = "straight"

        return result

    # ======================== GROUND PLANE ANALYSIS ========================

    def _analyze_ground_plane(self, frame, hsv, edges, h, w) -> Dict:
        """
        Analyze the lower portion of the frame as potential ground/walkable area.

        Determines:
        - Is ground visible
        - Ground surface type
        - Walkable ratio
        """
        result = {
            "visible": True,
            "type": "unknown",
            "walkable_ratio": 0.0,
        }

        # Lower 40% is typically ground
        ground_region = hsv[int(h * 0.6):, :]
        ground_gray = cv2.cvtColor(
            frame[int(h * 0.6):, :], cv2.COLOR_BGR2GRAY
        )
        ground_edges = edges[int(h * 0.6):, :]

        gh, gw = ground_region.shape[:2]

        # Ground surface classification via color
        # Check for road/pavement (gray tones, low saturation)
        road_mask = cv2.inRange(ground_region, self.ROAD_HSV_LOW, self.ROAD_HSV_HIGH)
        road_ratio = float(np.count_nonzero(road_mask)) / max(road_mask.size, 1)

        # Check for grass (green)
        grass_mask = cv2.inRange(ground_region, self.GRASS_HSV_LOW, self.GRASS_HSV_HIGH)
        grass_ratio = float(np.count_nonzero(grass_mask)) / max(grass_mask.size, 1)

        # Tile/indoor floor: moderate saturation, brownish or light tones
        sat_channel = ground_region[:, :, 1]
        val_channel = ground_region[:, :, 2]
        avg_sat = float(np.mean(sat_channel))
        avg_val = float(np.mean(val_channel))

        # Ground type classification
        if road_ratio > 0.3:
            result["type"] = "pavement"
            result["walkable_ratio"] = road_ratio
        elif grass_ratio > 0.3:
            result["type"] = "grass"
            result["walkable_ratio"] = grass_ratio * 0.8  # grass is walkable but less ideal
        elif avg_sat < 40 and avg_val > 120:
            result["type"] = "tile"  # indoor tile floor
            result["walkable_ratio"] = 0.7
        elif avg_sat < 40 and avg_val < 120:
            result["type"] = "concrete"
            result["walkable_ratio"] = 0.6
        else:
            result["type"] = "unknown"
            result["walkable_ratio"] = 0.3

        # Check if ground is actually visible (not blocked by a wall filling bottom)
        ground_color_std = float(np.std(ground_gray))
        ground_edge_density = float(np.count_nonzero(ground_edges)) / max(ground_edges.size, 1)

        # If the ground region is extremely uniform AND no edges -> wall filling frame
        if ground_color_std < 15 and ground_edge_density < 0.01:
            result["visible"] = False
            result["walkable_ratio"] = 0.0
            result["type"] = "blocked"

        return result

    # ======================== ENVIRONMENT CLASSIFICATION ========================

    def _classify_environment(
        self, gray, hsv, edges, zones, wall_ahead, road_info, ground_info, h, w
    ) -> Tuple[EnvironmentType, float]:
        """Classify the environment type using multiple visual cues."""

        # Feature extraction
        # 1. Sky presence (top 25%)
        top_region = hsv[: h // 4, :]
        sky_mask = cv2.inRange(top_region, self.SKY_HSV_LOW, self.SKY_HSV_HIGH)
        sky_ratio = float(np.count_nonzero(sky_mask)) / max(sky_mask.size, 1)

        # Also check for bright overcast sky
        top_val = top_region[:, :, 2]
        bright_top = float(np.mean(top_val))

        has_sky = sky_ratio > 0.15 or bright_top > 180

        # 2. Road features
        has_road = road_info.get("edges_found", False)
        ground_type = ground_info.get("type", "unknown")

        # 3. Edge distribution (corridors have parallel vertical edges)
        left_edge_density = zones[0].edge_density if zones else 0
        right_edge_density = zones[2].edge_density if zones else 0
        center_edge_density = zones[1].edge_density if zones else 0

        # 4. Overall brightness handling
        avg_brightness = float(np.mean(gray))

        # Classification logic
        confidence = 0.5  # default

        if has_sky and has_road and ground_type in ("pavement", "concrete"):
            env = EnvironmentType.OUTDOOR_ROAD
            confidence = 0.8
        elif has_road and ground_type in ("pavement", "concrete"):
            # Road edges + pavement = road, even if sky not visible (bus/buildings block)
            env = EnvironmentType.OUTDOOR_ROAD
            confidence = 0.7
        elif has_sky and ground_type == "grass":
            env = EnvironmentType.OUTDOOR_OPEN
            confidence = 0.7
        elif has_sky and ground_type in ("pavement", "concrete") and not has_road:
            env = EnvironmentType.OUTDOOR_SIDEWALK
            confidence = 0.65
        elif has_sky:
            env = EnvironmentType.OUTDOOR_OPEN
            confidence = 0.55
        elif ground_type in ("pavement", "concrete") and not wall_ahead:
            # Pavement without sky = could be covered walkway or tunnel
            env = EnvironmentType.OUTDOOR_SIDEWALK
            confidence = 0.5
        elif wall_ahead and ground_type in ("tile", "unknown", "blocked"):
            # Indoor with wall ahead
            if left_edge_density > 0.04 and right_edge_density > 0.04:
                env = EnvironmentType.INDOOR_CORRIDOR
                confidence = 0.7
            else:
                env = EnvironmentType.INDOOR_ROOM
                confidence = 0.65
        elif ground_type == "tile":
            env = EnvironmentType.INDOOR_ROOM
            confidence = 0.6
        elif (
            left_edge_density > 0.05
            and right_edge_density > 0.05
            and center_edge_density < 0.03
        ):
            env = EnvironmentType.INDOOR_CORRIDOR
            confidence = 0.6
        else:
            env = EnvironmentType.UNKNOWN
            confidence = 0.3

        return env, confidence

    # ======================== PATH STATUS ========================

    def _determine_path_status(
        self, zones, wall_ahead, wall_dir, road_info, ground_info
    ) -> Tuple[PathStatus, str]:
        """Determine overall path status and best direction."""

        walkable_ratio = ground_info.get("walkable_ratio", 0.0)
        ground_visible = ground_info.get("visible", True)

        # Wall ahead is the strongest signal
        if wall_ahead and not ground_visible:
            return PathStatus.WALL_AHEAD, self._find_open_direction(zones)

        if wall_ahead:
            return PathStatus.WALL_AHEAD, self._find_open_direction(zones)

        # Check zone blockage
        center_zone = zones[1] if len(zones) > 1 else None
        left_zone = zones[0] if zones else None
        right_zone = zones[2] if len(zones) > 2 else None

        blocked_count = sum(1 for z in zones if z.has_obstacle or z.has_wall)

        if blocked_count >= 3:
            # All zones blocked - but verify it's not just a busy outdoor scene
            # Real blockage has walls or very high depth+edge combo
            wall_count = sum(1 for z in zones if z.has_wall)
            if wall_count >= 2:
                return PathStatus.BLOCKED, "none"
            else:
                return PathStatus.PARTIALLY_BLOCKED, self._find_open_direction(zones)
        elif blocked_count >= 2:
            return PathStatus.PARTIALLY_BLOCKED, self._find_open_direction(zones)

        # Road edge proximity warning
        if road_info.get("edges_found"):
            # If only one boundary detected, might be near edge
            if road_info.get("left_boundary") and not road_info.get("right_boundary"):
                return PathStatus.EDGE_NEARBY, "right"  # steer away from left edge
            if road_info.get("right_boundary") and not road_info.get("left_boundary"):
                return PathStatus.EDGE_NEARBY, "left"

        if walkable_ratio > 0.3:
            return PathStatus.CLEAR, "forward"
        elif walkable_ratio > 0.1:
            return PathStatus.PARTIALLY_BLOCKED, self._find_open_direction(zones)
        else:
            return PathStatus.NO_PATH, "none"

    def _find_open_direction(self, zones: List[ZoneAnalysis]) -> str:
        """Find the most open direction from zone analysis."""
        if not zones:
            return "none"

        # Score each zone: prefer walkable, low obstacle, low wall
        scores = {}
        for z in zones:
            score = 0.0
            if z.is_walkable:
                score += 3.0
            if not z.has_obstacle:
                score += 2.0
            if not z.has_wall:
                score += 2.0
            score -= z.avg_depth_hint  # lower depth (far) is better
            scores[z.zone] = score

        best = max(scores, key=scores.get)
        return best

    # ======================== AUDIO GUIDANCE GENERATION ========================

    def _generate_guidance(
        self,
        env_type, path_status, path_dir,
        wall_ahead, wall_dist, wall_dir,
        road_info, ground_info, zones,
    ) -> Tuple[str, str]:
        """Generate human-like scene description and navigation guidance."""

        # Scene description
        env_desc = {
            EnvironmentType.INDOOR_ROOM: "You appear to be indoors, in a room",
            EnvironmentType.INDOOR_CORRIDOR: "You are in an indoor corridor or hallway",
            EnvironmentType.OUTDOOR_ROAD: "You are on a road",
            EnvironmentType.OUTDOOR_SIDEWALK: "You are on a sidewalk or paved path",
            EnvironmentType.OUTDOOR_OPEN: "You are in an open outdoor area",
            EnvironmentType.STAIRWAY: "There appear to be stairs ahead",
            EnvironmentType.UNKNOWN: "Analyzing your surroundings",
        }.get(env_type, "Analyzing surroundings")

        ground_desc = ""
        gt = ground_info.get("type", "unknown")
        if gt == "pavement":
            ground_desc = "on paved ground"
        elif gt == "grass":
            ground_desc = "on grass"
        elif gt == "tile":
            ground_desc = "on a tiled floor"
        elif gt == "concrete":
            ground_desc = "on concrete"
        elif gt == "blocked":
            ground_desc = "with no visible ground ahead"

        if ground_desc:
            scene_desc = f"{env_desc}, {ground_desc}."
        else:
            scene_desc = f"{env_desc}."

        # Navigation guidance
        nav_parts = []

        # Wall warning (highest priority)
        if wall_ahead:
            if wall_dist == "immediate":
                if wall_dir == "center":
                    nav_parts.append("Wall directly ahead, very close. Stop")
                elif wall_dir == "left":
                    nav_parts.append("Wall on your left side, very close")
                else:
                    nav_parts.append("Wall on your right side, very close")
            elif wall_dist == "near":
                nav_parts.append(f"Wall detected ahead")
            else:
                nav_parts.append("Wall or large surface detected in the distance")

            # Suggest direction
            if path_dir in ("left", "right"):
                nav_parts.append(f"Turn {path_dir}")
            elif path_dir == "center":
                nav_parts.append("Proceed slowly")
            elif path_dir == "none":
                nav_parts.append("Stop and reassess")

        # Road edge warning
        elif path_status == PathStatus.EDGE_NEARBY:
            if path_dir == "left":
                nav_parts.append("Road edge detected on your right. Move slightly left")
            elif path_dir == "right":
                nav_parts.append("Road edge detected on your left. Move slightly right")
            else:
                nav_parts.append("Road boundary nearby. Stay centered")

        # Path blocked
        elif path_status == PathStatus.BLOCKED:
            nav_parts.append("Path ahead appears blocked. Stop and look for another way")

        elif path_status == PathStatus.PARTIALLY_BLOCKED:
            if path_dir in ("left", "right"):
                nav_parts.append(f"Partial obstruction ahead. Move towards your {path_dir}")
            else:
                nav_parts.append("Partial obstruction ahead. Proceed with caution")

        elif path_status == PathStatus.NO_PATH:
            nav_parts.append("No clear path detected. Stop and reassess")

        elif path_status == PathStatus.CLEAR:
            # Road info
            if road_info.get("edges_found"):
                rd = road_info.get("direction", "straight")
                if rd == "curves_left":
                    nav_parts.append("Path is clear. Road curves to the left ahead")
                elif rd == "curves_right":
                    nav_parts.append("Path is clear. Road curves to the right ahead")
                else:
                    nav_parts.append("Path is clear. Road continues straight")
            else:
                nav_parts.append("Path looks clear ahead")

        if not nav_parts:
            nav_parts.append("Continue forward carefully")

        nav_guidance = ". ".join(nav_parts) + "."

        return scene_desc, nav_guidance

    # ======================== UTILITY METHODS ========================

    def _is_ground_region(self, hsv_region: np.ndarray) -> bool:
        """Check if an HSV region looks like walkable ground."""
        if hsv_region.size == 0:
            return False
        # Road/pavement
        road_mask = cv2.inRange(hsv_region, self.ROAD_HSV_LOW, self.ROAD_HSV_HIGH)
        road_ratio = float(np.count_nonzero(road_mask)) / max(road_mask.size, 1)
        if road_ratio > 0.25:
            return True
        # Tile/light floor
        sat = float(np.mean(hsv_region[:, :, 1]))
        val = float(np.mean(hsv_region[:, :, 2]))
        if sat < 50 and val > 100:
            return True
        return False

    def _describe_dominant_color(self, hsv_region: np.ndarray) -> str:
        """Describe the dominant color of a region."""
        if hsv_region.size == 0:
            return "unknown"
        avg_h = float(np.mean(hsv_region[:, :, 0]))
        avg_s = float(np.mean(hsv_region[:, :, 1]))
        avg_v = float(np.mean(hsv_region[:, :, 2]))

        if avg_s < 30:
            if avg_v < 60:
                return "dark"
            elif avg_v > 200:
                return "white"
            else:
                return "gray"
        elif avg_h < 15 or avg_h > 165:
            return "red"
        elif avg_h < 30:
            return "orange"
        elif avg_h < 45:
            return "yellow"
        elif avg_h < 90:
            return "green"
        elif avg_h < 130:
            return "blue"
        else:
            return "purple"
