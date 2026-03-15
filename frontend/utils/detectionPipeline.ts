/**
 * On-Device Robust Detection Pipeline
 * ====================================
 * TypeScript port of robust_detection_pipeline.py
 * Runs entirely on Android — NO server, NO WiFi needed.
 *
 * Implements:
 * - Frame-to-frame object tracking with persistent IDs
 * - Confidence smoothing (moving average)
 * - Motion classification (approaching/moving/stationary)
 * - Stable risk decision engine with hysteresis
 * - Alert escalation with deduplication
 * - Fail-safe fallback logic
 */

import {
  analyzeObstaclePosition,
  buildCorridorDebugOverlay,
  countLaneOccupancy,
  getCrowdAwarenessMessages,
  type CorridorDebugOverlay,
  type CorridorLane,
  type CorridorLaneCounters,
  type CorridorObstacle,
  type DistanceBucket,
} from "@/navigation/corridorMapping";

// ==================== ENUMS ====================

export enum MotionState {
  STATIONARY = "stationary",
  MOVING_SIDEWAYS = "moving_sideways",
  APPROACHING = "approaching",
  RECEDING = "receding",
}

export enum RiskLevel {
  SAFE = "safe",
  CAUTION = "caution",
  DANGER = "danger",
  CRITICAL = "critical",
}

export type CalibrationState = "INIT" | "CALIBRATING" | "ACTIVE";

export type AlertPriority = "critical" | "danger" | "caution" | "awareness";

export enum AlertTriggerEvent {
  NEW_OBSTACLE = "new_obstacle",
  OBSTACLE_PERSISTS = "obstacle_persists",
  OBSTACLE_APPROACHING = "obstacle_approaching",
  OBSTACLE_CLEARED = "obstacle_cleared",
  CONFIDENCE_INCREASE = "confidence_increase",
  MOTION_DETECTED = "motion_detected",
}

// ==================== DATA CLASSES ====================

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function bboxCenter(b: BoundingBox): [number, number] {
  return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
}

export function bboxArea(b: BoundingBox): number {
  return Math.max((b.x2 - b.x1) * (b.y2 - b.y1), 0.0001);
}

export interface RawDetection {
  classId: number;
  className: string;
  confidence: number;
  bbox: BoundingBox;
  frameWidth: number;
  frameHeight: number;
}

export interface TrackedObject {
  objectId: string;
  className: string;
  frameBorn: number;
  lastSeenFrame: number;
  bboxHistory: BoundingBox[];
  confidenceHistory: number[];
  motionState: MotionState;
  velocity: [number, number];
  areaGrowthRate: number;
  decayCounter: number;
  visibilityStreak: number;
  smoothedConfidence: number;
  isPersistent: boolean;
}

const MAX_HISTORY = 10;

function createTrackedObject(
  objectId: string,
  className: string,
  frameIdx: number
): TrackedObject {
  return {
    objectId,
    className,
    frameBorn: frameIdx,
    lastSeenFrame: frameIdx,
    bboxHistory: [],
    confidenceHistory: [],
    motionState: MotionState.STATIONARY,
    velocity: [0, 0],
    areaGrowthRate: 0,
    decayCounter: 0,
    visibilityStreak: 0,
    smoothedConfidence: 0,
    isPersistent: false,
  };
}

function addDetection(
  obj: TrackedObject,
  bbox: BoundingBox,
  confidence: number,
  frameIdx: number
): void {
  obj.bboxHistory.push(bbox);
  if (obj.bboxHistory.length > MAX_HISTORY) obj.bboxHistory.shift();
  obj.confidenceHistory.push(confidence);
  if (obj.confidenceHistory.length > MAX_HISTORY) obj.confidenceHistory.shift();
  obj.lastSeenFrame = frameIdx;
  obj.decayCounter = 0;
  obj.visibilityStreak += 1;
  updateMotionMetrics(obj);
  updateSmoothedConfidence(obj);
}

function updateMotionMetrics(obj: TrackedObject): void {
  if (obj.bboxHistory.length < 2) return;
  const prev = obj.bboxHistory[obj.bboxHistory.length - 2];
  const curr = obj.bboxHistory[obj.bboxHistory.length - 1];
  const prevCenter = bboxCenter(prev);
  const currCenter = bboxCenter(curr);
  obj.velocity = [currCenter[0] - prevCenter[0], currCenter[1] - prevCenter[1]];
  const prevArea = bboxArea(prev);
  if (prevArea > 0) {
    obj.areaGrowthRate = (bboxArea(curr) - prevArea) / prevArea;
  }
}

function updateSmoothedConfidence(obj: TrackedObject): void {
  if (obj.confidenceHistory.length === 0) return;
  const sum = obj.confidenceHistory.reduce((a, b) => a + b, 0);
  obj.smoothedConfidence = sum / obj.confidenceHistory.length;

  const largeArea =
    obj.bboxHistory.length > 0 &&
    bboxArea(obj.bboxHistory[obj.bboxHistory.length - 1]) >= 0.15;
  const highConf = obj.smoothedConfidence >= 0.55;
  const mediumConf = obj.smoothedConfidence >= 0.28;
  const lastArea =
    obj.bboxHistory.length > 0
      ? bboxArea(obj.bboxHistory[obj.bboxHistory.length - 1])
      : 0;

  // More responsive persistence so first-frame obstacles are not hidden.
  obj.isPersistent =
    (obj.visibilityStreak >= 1 && mediumConf && lastArea >= 0.04) ||
    (obj.visibilityStreak >= 2 && obj.smoothedConfidence >= 0.22) ||
    (obj.visibilityStreak >= 1 && highConf && (largeArea || lastArea >= 0.015));
}

function classifyMotion(obj: TrackedObject): MotionState {
  if (obj.bboxHistory.length < 2) {
    obj.motionState = MotionState.STATIONARY;
    return obj.motionState;
  }
  const VELOCITY_THRESHOLD = 0.02;
  const GROWTH_THRESHOLD = 0.05;
  if (obj.areaGrowthRate > GROWTH_THRESHOLD) {
    obj.motionState = MotionState.APPROACHING;
  } else if (obj.areaGrowthRate < -GROWTH_THRESHOLD) {
    obj.motionState = MotionState.RECEDING;
  } else if (Math.abs(obj.velocity[0]) > VELOCITY_THRESHOLD) {
    obj.motionState = MotionState.MOVING_SIDEWAYS;
  } else {
    obj.motionState = MotionState.STATIONARY;
  }
  return obj.motionState;
}

function isApproaching(obj: TrackedObject): boolean {
  if (obj.motionState !== MotionState.APPROACHING) return false;
  if (obj.bboxHistory.length < 2) return false;
  const centerY = bboxCenter(obj.bboxHistory[obj.bboxHistory.length - 1])[1];
  return centerY > 0.5 && obj.areaGrowthRate > 0.03;
}

// ==================== DETECTION FRAME RESULT ====================

export interface DetectionFrame {
  frameIndex: number;
  timestamp: number;
  rawDetections: RawDetection[];
  trackedObjects: TrackedObject[];
  safeDirection: string;
  riskLevel: RiskLevel;
  audioMessage: string;
  alertTriggered: boolean;
  alertReason: AlertTriggerEvent | null;
  obstacles: ObstacleEntry[];
  detectionCoords: DetectionCoord[];
  calibrationState: CalibrationState;
  alertPriority: AlertPriority;
  laneCounters: CorridorLaneCounters;
  corridorAnalysisMs: number;
  corridorDebugOverlay?: CorridorDebugOverlay;
}

export interface ObstacleEntry {
  type: string;
  distance: DistanceBucket;
  direction: string;
  lane: CorridorLane;
  confidence: number;
  moving: string;
  persistenceFrames: number;
  objectId: string;
}

export interface DetectionCoord {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  confidence: number;
  distance: DistanceBucket;
  objectId: string;
}

// ==================== OBJECT TRACKER ====================

export class ObjectTracker {
  trackedObjects: Map<string, TrackedObject> = new Map();
  private nextObjectId = 0;
  private decayThreshold = 2;
  private matchDistanceThreshold = 0.15;
  private matchSizeThreshold = 0.3;

  update(rawDetections: RawDetection[], frameIdx: number): TrackedObject[] {
    // Decay all
    for (const obj of this.trackedObjects.values()) {
      obj.decayCounter += 1;
    }

    // Match detections
    const matchedIds = new Set<string>();
    for (const det of rawDetections) {
      const matchId = this.findBestMatch(det);
      if (matchId) {
        const obj = this.trackedObjects.get(matchId)!;
        addDetection(obj, det.bbox, det.confidence, frameIdx);
        matchedIds.add(matchId);
      } else {
        const newId = this.createNewId();
        const newObj = createTrackedObject(newId, det.className, frameIdx);
        addDetection(newObj, det.bbox, det.confidence, frameIdx);
        this.trackedObjects.set(newId, newObj);
      }
    }

    // Remove decayed
    const toRemove: string[] = [];
    for (const [id, obj] of this.trackedObjects) {
      if (obj.decayCounter > this.decayThreshold) toRemove.push(id);
    }
    for (const id of toRemove) this.trackedObjects.delete(id);

    return Array.from(this.trackedObjects.values());
  }

  private findBestMatch(det: RawDetection): string | null {
    let best: { dist: number; id: string } | null = null;
    for (const [id, obj] of this.trackedObjects) {
      if (obj.className !== det.className) continue;
      if (obj.decayCounter > 2) continue;
      const lastBbox = obj.bboxHistory[obj.bboxHistory.length - 1];
      if (!lastBbox) continue;
      const dist = bboxDistance(lastBbox, det.bbox);
      const sizeRatio = bboxArea(lastBbox) / bboxArea(det.bbox);
      if (
        dist < this.matchDistanceThreshold &&
        1 - this.matchSizeThreshold < sizeRatio &&
        sizeRatio < 1 + this.matchSizeThreshold
      ) {
        if (!best || dist < best.dist) best = { dist, id };
      }
    }
    return best?.id ?? null;
  }

  private createNewId(): string {
    this.nextObjectId += 1;
    return `obj_${this.nextObjectId}`;
  }

  reset(): void {
    this.trackedObjects.clear();
    this.nextObjectId = 0;
  }
}

function bboxDistance(a: BoundingBox, b: BoundingBox): number {
  const ca = bboxCenter(a);
  const cb = bboxCenter(b);
  return Math.sqrt((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2);
}

interface CorridorTrackedObstacle extends CorridorObstacle {
  objectId: string;
  moving: MotionState;
  persistenceFrames: number;
  bbox: BoundingBox;
  direction: string;
}

interface RiskContext {
  centerImmediate: CorridorTrackedObstacle[];
  centerNear: CorridorTrackedObstacle[];
  sideNear: CorridorTrackedObstacle[];
  laneCounters: CorridorLaneCounters;
  awarenessMessages: string[];
}

const nowMs = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

function laneFromCenterX(centerX: number): string {
  if (centerX < 0.25) return "left";
  if (centerX < 0.42) return "front-left";
  if (centerX <= 0.58) return "front";
  if (centerX <= 0.75) return "front-right";
  return "right";
}

function sidePressure(context: RiskContext, lane: "left" | "right"): number {
  const sideNearLoad = context.sideNear.filter((item) => item.lane === lane).length;
  const crowdLoad = lane === "left" ? context.laneCounters.leftLaneCount : context.laneCounters.rightLaneCount;
  return sideNearLoad + crowdLoad;
}

function chooseSaferSide(context: RiskContext): "left" | "right" | "stop" {
  const leftLoad = sidePressure(context, "left");
  const rightLoad = sidePressure(context, "right");

  if (leftLoad > 0 && rightLoad > 0 && Math.abs(leftLoad - rightLoad) <= 1) {
    return "stop";
  }

  return leftLoad <= rightLoad ? "left" : "right";
}

// ==================== STABLE RISK DECISION ENGINE ====================

export class StableRiskDecisionEngine {
  currentRisk: RiskLevel = RiskLevel.SAFE;
  private persistCounter = 0;
  private thresholds: Record<RiskLevel, number> = {
    [RiskLevel.SAFE]: 3,
    [RiskLevel.CAUTION]: 1,
    [RiskLevel.DANGER]: 1,
    [RiskLevel.CRITICAL]: 1,
  };

  evaluate(
    corridorObstacles: CorridorTrackedObstacle[]
  ): { riskLevel: RiskLevel; safeDirection: string; shouldTrigger: boolean; context: RiskContext } {
    if (corridorObstacles.length === 0) {
      return {
        riskLevel: this.transitionRisk(RiskLevel.SAFE),
        safeDirection: "forward",
        shouldTrigger: false,
        context: {
          centerImmediate: [],
          centerNear: [],
          sideNear: [],
          laneCounters: {
            leftLaneCount: 0,
            centerLaneCount: 0,
            rightLaneCount: 0,
          },
          awarenessMessages: [],
        },
      };
    }

    const centerImmediate = corridorObstacles.filter(
      (item) => item.lane === "center" && item.distance === "immediate"
    );
    const centerNear = corridorObstacles.filter(
      (item) => item.lane === "center" && item.distance === "near"
    );
    const sideNear = corridorObstacles.filter(
      (item) => item.lane !== "center" && (item.distance === "near" || item.distance === "immediate")
    );

    const laneCounters = countLaneOccupancy(corridorObstacles);
    const awarenessMessages = getCrowdAwarenessMessages(laneCounters);

    const context: RiskContext = {
      centerImmediate,
      centerNear,
      sideNear,
      laneCounters,
      awarenessMessages,
    };

    let safeDirection = "forward";
    if (centerImmediate.length > 0) {
      safeDirection = chooseSaferSide(context);
    } else if (centerNear.length > 0) {
      const leftLoad = sidePressure(context, "left");
      const rightLoad = sidePressure(context, "right");
      safeDirection = leftLoad <= rightLoad ? "left" : "right";
    } else if (sideNear.length > 0) {
      const leftNear = sideNear.filter((item) => item.lane === "left").length;
      const rightNear = sideNear.filter((item) => item.lane === "right").length;

      if (leftNear > 0 && rightNear === 0) safeDirection = "right";
      else if (rightNear > 0 && leftNear === 0) safeDirection = "left";
    }

    let newRisk: RiskLevel;
    if (centerImmediate.length > 0) newRisk = RiskLevel.CRITICAL;
    else if (centerNear.length > 0) newRisk = RiskLevel.DANGER;
    else if (sideNear.length > 0) newRisk = RiskLevel.CAUTION;
    else newRisk = RiskLevel.SAFE;

    const { risk: finalRisk, trigger: shouldTrigger } =
      this.applyHysteresis(newRisk);
    return {
      riskLevel: finalRisk,
      safeDirection,
      shouldTrigger,
      context,
    };
  }

  private transitionRisk(newRisk: RiskLevel): RiskLevel {
    if (newRisk === this.currentRisk) {
      this.persistCounter = 0;
      return this.currentRisk;
    }
    const threshold = this.thresholds[newRisk] ?? 1;
    this.persistCounter += 1;
    if (this.persistCounter >= threshold) {
      this.currentRisk = newRisk;
      this.persistCounter = 0;
    }
    return this.currentRisk;
  }

  private applyHysteresis(newRisk: RiskLevel): {
    risk: RiskLevel;
    trigger: boolean;
  } {
    let trigger = false;
    if (newRisk !== this.currentRisk) {
      const threshold = this.thresholds[newRisk] ?? 1;
      this.persistCounter += 1;
      if (this.persistCounter >= threshold) {
        this.currentRisk = newRisk;
        this.persistCounter = 0;
        trigger = true;
      }
    } else {
      this.persistCounter = 0;
    }
    return { risk: this.currentRisk, trigger };
  }
}

// ==================== ALERT MANAGER ====================

export class AlertManager {
  private lastAlertMessage = "";

  generateAlert(
    riskLevel: RiskLevel,
    context: RiskContext,
    safeDirection: string,
    forceNew = false
  ): { message: string; event: AlertTriggerEvent | null; priority: AlertPriority } {
    let message: string;
    let event: AlertTriggerEvent | null;
    let priority: AlertPriority;

    if (riskLevel === RiskLevel.CRITICAL) {
      message = this.buildCriticalMessage(context.centerImmediate, safeDirection);
      event = AlertTriggerEvent.OBSTACLE_APPROACHING;
      priority = "critical";
    } else if (riskLevel === RiskLevel.DANGER) {
      message = this.buildDangerMessage(context.centerNear, safeDirection);
      event = AlertTriggerEvent.OBSTACLE_PERSISTS;
      priority = "danger";
    } else if (riskLevel === RiskLevel.CAUTION) {
      message = this.buildCautionMessage(context.sideNear);
      event = AlertTriggerEvent.MOTION_DETECTED;
      priority = "caution";
    } else if (context.awarenessMessages.length > 0) {
      message = context.awarenessMessages.join(". ");
      event = AlertTriggerEvent.MOTION_DETECTED;
      priority = "awareness";
    } else {
      message = "Path looks clear. Continue forward.";
      event = AlertTriggerEvent.OBSTACLE_CLEARED;
      priority = "awareness";
    }

    // Dedup
    if (message === this.lastAlertMessage && !forceNew) {
      return { message: "", event: null, priority };
    }
    this.lastAlertMessage = message;
    return { message, event, priority };
  }

  private buildCriticalMessage(
    objects: CorridorTrackedObstacle[],
    direction: string
  ): string {
    const primary = objects[0]?.type ?? "obstacle";
    const turnHint: Record<string, string> = {
      left: "Turn left immediately.",
      right: "Turn right immediately.",
      forward: "Back up immediately.",
      stop: "Stop. You are blocked.",
    };
    if (direction === "stop") {
      return "Obstacle blocking path. Stop.";
    }
    return `${primary} ahead. Move ${direction === "left" ? "slightly left" : "slightly right"}.`;
  }

  private buildDangerMessage(
    objects: CorridorTrackedObstacle[],
    direction: string
  ): string {
    if (objects.length === 0) return "Danger ahead. Proceed carefully.";
    const types = objects
      .slice(0, 2)
      .map((o) => o.type)
      .join(", ");
    if (direction === "left" || direction === "right") {
      return `${types} ahead. Move slightly ${direction}.`;
    }
    return `Danger: ${types} ahead. Slow down and reassess.`;
  }

  private buildCautionMessage(sideObjects: CorridorTrackedObstacle[]): string {
    if (sideObjects.length === 0) {
      return "Caution. Possible obstacles detected.";
    }

    const top = sideObjects.slice(0, 2).map((entry) => {
      return `${entry.type} on ${entry.lane}`;
    });
    return `Caution. ${top.join(" and ")}. Keep centered.`;
  }
}

// ==================== FAIL-SAFE MANAGER ====================

export function getFailsafeResponse(errorType: string): {
  message: string;
  riskLevel: RiskLevel;
} {
  const responses: Record<string, { message: string; riskLevel: RiskLevel }> = {
    image_invalid: {
      message: "Unable to analyze image. Move slowly.",
      riskLevel: RiskLevel.CAUTION,
    },
    model_unavailable: {
      message: "Detection system loading. Proceed with caution.",
      riskLevel: RiskLevel.CAUTION,
    },
    inference_timeout: {
      message: "Detection taking too long. Use caution ahead.",
      riskLevel: RiskLevel.CAUTION,
    },
    unknown_error: {
      message: "Detection error. Stop and reassess surroundings.",
      riskLevel: RiskLevel.DANGER,
    },
  };
  return responses[errorType] ?? responses.unknown_error;
}

// ==================== MOBILITY-RELEVANT CLASSES (COCO) ====================

export const MOBILITY_RELEVANT_CLASSES = new Set([
  "person", "bicycle", "car", "motorcycle", "bus", "truck", "train",
  "traffic light", "stop sign", "bench", "dog", "cat", "chair",
  "potted plant", "couch", "bed", "dining table", "toilet", "tv",
  "laptop", "refrigerator", "oven", "sink", "fire hydrant",
  "parking meter", "backpack", "umbrella", "handbag", "suitcase",
  "bottle", "cup", "vase", "scissors", "book", "clock",
]);

// COCO class names (80 classes) — index matches YOLO output
export const COCO_CLASSES: string[] = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
  "truck", "boat", "traffic light", "fire hydrant", "stop sign",
  "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep",
  "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
  "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard",
  "sports ball", "kite", "baseball bat", "baseball glove", "skateboard",
  "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork",
  "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
  "couch", "potted plant", "bed", "dining table", "toilet", "tv",
  "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave",
  "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
  "scissors", "teddy bear", "hair drier", "toothbrush",
];

// ==================== ROBUST DETECTION PIPELINE ====================

export class RobustDetectionPipeline {
  tracker = new ObjectTracker();
  riskEngine = new StableRiskDecisionEngine();
  alertManager = new AlertManager();
  frameIndex = 0;
  private calibrationState: CalibrationState = "INIT";
  private stableFrameCount = 0;
  private readonly calibrationFramesRequired = 4;
  private frameSignature = "";
  private calibrationPromptPending = true;

  /**
   * Process a single frame of raw detections through the full pipeline.
   * Returns a complete DetectionFrame with obstacles, risk level, and audio message.
   * NO network calls — runs entirely on-device.
   */
  processFrame(
    rawDetections: RawDetection[],
    frameWidth: number,
    frameHeight: number
  ): DetectionFrame {
    this.frameIndex += 1;
    this.updateCalibrationState(frameWidth, frameHeight);

    // 1. Track objects across frames
    const tracked = this.tracker.update(rawDetections, this.frameIndex);

    // 2. Corridor mapping (must stay lightweight)
    const tCorridorStart = nowMs();
    const obstacles: ObstacleEntry[] = [];
    const detectionCoords: DetectionCoord[] = [];
    const corridorTracked: CorridorTrackedObstacle[] = [];

    for (const obj of tracked) {
      const shouldExpose = obj.isPersistent || (obj.decayCounter === 0 && obj.smoothedConfidence >= 0.3);
      if (!shouldExpose) continue;

      const lastBbox = obj.bboxHistory[obj.bboxHistory.length - 1];
      if (!lastBbox) continue;

      const analyzed = analyzeObstaclePosition(
        {
          className: obj.className,
          confidence: obj.smoothedConfidence,
          bbox: lastBbox,
        },
        frameWidth,
        frameHeight
      );

      if (!analyzed) continue;

      const centerX = bboxCenter(lastBbox)[0];
      const direction = laneFromCenterX(centerX);
      const mapped: CorridorTrackedObstacle = {
        ...analyzed,
        objectId: obj.objectId,
        moving: obj.motionState,
        persistenceFrames: obj.visibilityStreak,
        bbox: lastBbox,
        direction,
      };

      corridorTracked.push(mapped);

      obstacles.push({
        type: mapped.type,
        distance: mapped.distance,
        direction,
        lane: mapped.lane,
        confidence: Math.round(mapped.confidence * 1000) / 1000,
        moving: mapped.moving,
        persistenceFrames: mapped.persistenceFrames,
        objectId: mapped.objectId,
      });

      detectionCoords.push({
        x1: Math.round(lastBbox.x1 * 10000) / 10000,
        y1: Math.round(lastBbox.y1 * 10000) / 10000,
        x2: Math.round(lastBbox.x2 * 10000) / 10000,
        y2: Math.round(lastBbox.y2 * 10000) / 10000,
        label: mapped.type,
        confidence: Math.round(mapped.confidence * 100) / 100,
        distance: mapped.distance,
        objectId: mapped.objectId,
      });
    }

    // Fallback to current raw detections when no tracked object has stabilized.
    if (corridorTracked.length === 0 && rawDetections.length > 0) {
      const topRaw = [...rawDetections]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);

      for (const det of topRaw) {
        const analyzed = analyzeObstaclePosition(
          {
            className: det.className,
            confidence: det.confidence,
            bbox: det.bbox,
          },
          frameWidth,
          frameHeight
        );

        if (!analyzed) continue;

        const direction = laneFromCenterX(bboxCenter(det.bbox)[0]);
        const rawId = `raw_${this.frameIndex}_${det.classId}`;

        corridorTracked.push({
          ...analyzed,
          objectId: rawId,
          moving: MotionState.STATIONARY,
          persistenceFrames: 1,
          bbox: det.bbox,
          direction,
        });

        obstacles.push({
          type: analyzed.type,
          distance: analyzed.distance,
          direction,
          lane: analyzed.lane,
          confidence: Math.round(analyzed.confidence * 1000) / 1000,
          moving: MotionState.STATIONARY,
          persistenceFrames: 1,
          objectId: rawId,
        });

        detectionCoords.push({
          x1: Math.round(det.bbox.x1 * 10000) / 10000,
          y1: Math.round(det.bbox.y1 * 10000) / 10000,
          x2: Math.round(det.bbox.x2 * 10000) / 10000,
          y2: Math.round(det.bbox.y2 * 10000) / 10000,
          label: analyzed.type,
          confidence: Math.round(analyzed.confidence * 100) / 100,
          distance: analyzed.distance,
          objectId: rawId,
        });
      }
    }

    const corridorAnalysisMs = Math.round((nowMs() - tCorridorStart) * 1000) / 1000;

    // 3. Evaluate risk
    const { riskLevel, safeDirection, shouldTrigger, context } =
      this.riskEngine.evaluate(corridorTracked);

    const laneCounters = context.laneCounters;
    const corridorDebugOverlay = __DEV__
      ? buildCorridorDebugOverlay(frameWidth, frameHeight)
      : undefined;

    // Calibration mutes navigation alerts until camera framing is stable.
    if (this.calibrationState !== "ACTIVE") {
      let calibrationMessage = "";
      let alertTriggered = false;

      if (this.calibrationPromptPending) {
        calibrationMessage = "Camera is calibrating. Please hold steady.";
        this.calibrationPromptPending = false;
        alertTriggered = true;
      }

      return {
        frameIndex: this.frameIndex,
        timestamp: Date.now(),
        rawDetections,
        trackedObjects: tracked,
        safeDirection: "forward",
        riskLevel: RiskLevel.SAFE,
        audioMessage: calibrationMessage,
        alertTriggered,
        alertReason: alertTriggered ? AlertTriggerEvent.NEW_OBSTACLE : null,
        obstacles,
        detectionCoords,
        calibrationState: this.calibrationState,
        alertPriority: "awareness",
        laneCounters,
        corridorAnalysisMs,
        corridorDebugOverlay,
      };
    }

    // 4. Generate alert
    const { message: alertMessage, event: alertEvent, priority: alertPriority } =
      this.alertManager.generateAlert(
        riskLevel,
        context,
        safeDirection,
        shouldTrigger
      );

    let audioMessage =
      alertMessage || this.getDefaultMessage(riskLevel, safeDirection, context);

    // Awareness messages must never interrupt critical navigation alerts.
    if (
      alertPriority === "awareness" &&
      (riskLevel === RiskLevel.CRITICAL || riskLevel === RiskLevel.DANGER || riskLevel === RiskLevel.CAUTION)
    ) {
      audioMessage = this.getDefaultMessage(riskLevel, safeDirection, context);
    }

    return {
      frameIndex: this.frameIndex,
      timestamp: Date.now(),
      rawDetections,
      trackedObjects: tracked,
      safeDirection,
      riskLevel,
      audioMessage,
      alertTriggered: shouldTrigger,
      alertReason: alertEvent,
      obstacles,
      detectionCoords,
      calibrationState: this.calibrationState,
      alertPriority,
      laneCounters,
      corridorAnalysisMs,
      corridorDebugOverlay,
    };
  }

  private getDefaultMessage(risk: RiskLevel, direction: string, context: RiskContext): string {
    switch (risk) {
      case RiskLevel.CRITICAL:
        return direction === "stop"
          ? "Obstacle blocking path. Stop."
          : `Obstacle ahead. Move ${direction}.`;
      case RiskLevel.DANGER:
        return `Person ahead. Move slightly ${direction}.`;
      case RiskLevel.CAUTION:
        return "Caution. Side obstacle nearby. Keep centered.";
      default:
        if (context.awarenessMessages.length > 0) {
          return context.awarenessMessages.join(". ");
        }
        return "Path clear. Continue forward.";
    }
  }

  private updateCalibrationState(frameWidth: number, frameHeight: number): void {
    const signature = `${frameWidth}x${frameHeight}`;

    if (this.calibrationState === "INIT") {
      this.calibrationState = "CALIBRATING";
      this.stableFrameCount = 0;
      this.calibrationPromptPending = true;
      this.frameSignature = signature;
    }

    if (this.frameSignature !== signature) {
      this.frameSignature = signature;
      this.calibrationState = "CALIBRATING";
      this.stableFrameCount = 0;
      this.calibrationPromptPending = true;
      return;
    }

    if (this.calibrationState === "CALIBRATING") {
      this.stableFrameCount += 1;
      if (this.stableFrameCount >= this.calibrationFramesRequired) {
        this.calibrationState = "ACTIVE";
      }
    }
  }

  reset(): void {
    this.tracker.reset();
    this.riskEngine.currentRisk = RiskLevel.SAFE;
    this.frameIndex = 0;
    this.calibrationState = "INIT";
    this.stableFrameCount = 0;
    this.frameSignature = "";
    this.calibrationPromptPending = true;
  }
}
