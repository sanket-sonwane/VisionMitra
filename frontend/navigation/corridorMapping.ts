import type { MessageKey } from "@/localization/messages";

export interface Point2D {
  x: number;
  y: number;
}

export interface GroundROI {
  width: number;
  height: number;
  bottomLeft: Point2D;
  bottomRight: Point2D;
  topLeft: Point2D;
  topRight: Point2D;
}

export type CorridorLane = "left" | "center" | "right";

export type DistanceBucket = "immediate" | "near" | "far" | "distant";

export interface CorridorDetectionInput {
  className?: string;
  type?: string;
  confidence: number;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

export interface CorridorObstacle {
  type: string;
  lane: CorridorLane;
  distance: DistanceBucket;
  confidence: number;
}

export interface CorridorLaneCounters {
  leftLaneCount: number;
  centerLaneCount: number;
  rightLaneCount: number;
}

export interface CorridorDebugOverlay {
  roi: Point2D[];
  centerCorridor: Point2D[];
  gridRows: Point2D[][];
}

const CENTER_CORRIDOR_RATIO = 0.4;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function computeGroundROI(width: number, height: number): GroundROI {
  return {
    width,
    height,
    bottomLeft: { x: 0.15 * width, y: height },
    bottomRight: { x: 0.85 * width, y: height },
    topLeft: { x: 0.4 * width, y: 0.55 * height },
    topRight: { x: 0.6 * width, y: 0.55 * height },
  };
}

export function getCorridorLane(xPosition: number, roi: GroundROI): CorridorLane {
  const bottomWidth = Math.max(1, roi.bottomRight.x - roi.bottomLeft.x);
  const centerWidth = bottomWidth * CENTER_CORRIDOR_RATIO;
  const sideWidth = (bottomWidth - centerWidth) * 0.5;
  const centerLeft = roi.bottomLeft.x + sideWidth;
  const centerRight = roi.bottomRight.x - sideWidth;

  if (xPosition < centerLeft) return "left";
  if (xPosition > centerRight) return "right";
  return "center";
}

export function estimateDistance(bottomY: number): DistanceBucket {
  const y = clamp01(bottomY);
  if (y > 0.85) return "immediate";
  if (y > 0.7) return "near";
  if (y > 0.55) return "far";
  return "distant";
}

function getHorizontalBoundsAtY(yPx: number, roi: GroundROI): { left: number; right: number } {
  const topY = roi.topLeft.y;
  const bottomY = roi.bottomLeft.y;
  const yClamped = Math.max(topY, Math.min(bottomY, yPx));
  const t = (yClamped - topY) / Math.max(1, bottomY - topY);

  return {
    left: roi.topLeft.x + (roi.bottomLeft.x - roi.topLeft.x) * t,
    right: roi.topRight.x + (roi.bottomRight.x - roi.topRight.x) * t,
  };
}

function isBottomCenterInsideROI(
  bottomCenterX: number,
  bottomCenterY: number,
  roi: GroundROI
): boolean {
  if (bottomCenterY < roi.topLeft.y || bottomCenterY > roi.bottomLeft.y) {
    return false;
  }

  const bounds = getHorizontalBoundsAtY(bottomCenterY, roi);
  return bottomCenterX >= bounds.left && bottomCenterX <= bounds.right;
}

function getLaneAtY(xPosition: number, yPx: number, roi: GroundROI): CorridorLane {
  const bounds = getHorizontalBoundsAtY(yPx, roi);
  const laneWidth = Math.max(1, bounds.right - bounds.left);
  const centerWidth = laneWidth * CENTER_CORRIDOR_RATIO;
  const sideWidth = (laneWidth - centerWidth) * 0.5;
  const centerLeft = bounds.left + sideWidth;
  const centerRight = bounds.right - sideWidth;

  if (xPosition < centerLeft) return "left";
  if (xPosition > centerRight) return "right";
  return "center";
}

export function analyzeObstaclePosition(
  detection: CorridorDetectionInput,
  frameWidth: number,
  frameHeight: number
): CorridorObstacle | null {
  const roi = computeGroundROI(frameWidth, frameHeight);
  const bbox = detection.bbox;

  const bottomCenterX = ((bbox.x1 + bbox.x2) * 0.5) * frameWidth;
  const bottomCenterY = bbox.y2 * frameHeight;

  if (!isBottomCenterInsideROI(bottomCenterX, bottomCenterY, roi)) {
    return null;
  }

  const lane = getLaneAtY(bottomCenterX, bottomCenterY, roi);
  const distance = estimateDistance(bbox.y2);

  return {
    type: detection.className || detection.type || "obstacle",
    lane,
    distance,
    confidence: detection.confidence,
  };
}

export function countLaneOccupancy(obstacles: CorridorObstacle[]): CorridorLaneCounters {
  const counters: CorridorLaneCounters = {
    leftLaneCount: 0,
    centerLaneCount: 0,
    rightLaneCount: 0,
  };

  for (const obstacle of obstacles) {
    if (obstacle.lane === "left") counters.leftLaneCount += 1;
    else if (obstacle.lane === "center") counters.centerLaneCount += 1;
    else counters.rightLaneCount += 1;
  }

  return counters;
}

export function getCrowdAwarenessMessages(
  counters: CorridorLaneCounters,
  threshold: number = 3
): MessageKey[] {
  const messageKeys: MessageKey[] = [];
  if (counters.leftLaneCount >= threshold) messageKeys.push("CROWD_LEFT");
  if (counters.rightLaneCount >= threshold) messageKeys.push("CROWD_RIGHT");
  return messageKeys;
}

export function buildCorridorDebugOverlay(
  width: number,
  height: number,
  rows: number = 4
): CorridorDebugOverlay {
  const roi = computeGroundROI(width, height);
  const roiPolygon = [roi.topLeft, roi.topRight, roi.bottomRight, roi.bottomLeft];

  const centerTopLane = getLaneAtY((roi.topLeft.x + roi.topRight.x) * 0.5, roi.topLeft.y, roi);
  const centerBottomLane = getLaneAtY((roi.bottomLeft.x + roi.bottomRight.x) * 0.5, roi.bottomLeft.y, roi);
  const centerCorridor: Point2D[] = [];

  if (centerTopLane && centerBottomLane) {
    const topBounds = getHorizontalBoundsAtY(roi.topLeft.y, roi);
    const topWidth = topBounds.right - topBounds.left;
    const topCenterWidth = topWidth * CENTER_CORRIDOR_RATIO;
    const topLeft = topBounds.left + (topWidth - topCenterWidth) * 0.5;
    const topRight = topBounds.right - (topWidth - topCenterWidth) * 0.5;

    const bottomBounds = getHorizontalBoundsAtY(roi.bottomLeft.y, roi);
    const bottomWidth = bottomBounds.right - bottomBounds.left;
    const bottomCenterWidth = bottomWidth * CENTER_CORRIDOR_RATIO;
    const bottomLeft = bottomBounds.left + (bottomWidth - bottomCenterWidth) * 0.5;
    const bottomRight = bottomBounds.right - (bottomWidth - bottomCenterWidth) * 0.5;

    centerCorridor.push(
      { x: topLeft, y: roi.topLeft.y },
      { x: topRight, y: roi.topRight.y },
      { x: bottomRight, y: roi.bottomRight.y },
      { x: bottomLeft, y: roi.bottomLeft.y }
    );
  }

  const gridRows: Point2D[][] = [];
  const usableRows = Math.max(1, rows);
  for (let i = 1; i <= usableRows; i++) {
    const t = i / (usableRows + 1);
    const y = roi.topLeft.y + (roi.bottomLeft.y - roi.topLeft.y) * t;
    const bounds = getHorizontalBoundsAtY(y, roi);
    gridRows.push([
      { x: bounds.left, y },
      { x: bounds.right, y },
    ]);
  }

  return {
    roi: roiPolygon,
    centerCorridor,
    gridRows,
  };
}