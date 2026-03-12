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
  const highConf = obj.smoothedConfidence >= 0.6;

  obj.isPersistent =
    (obj.visibilityStreak >= 2 && obj.smoothedConfidence >= 0.35) ||
    (obj.visibilityStreak >= 1 && highConf && largeArea);
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
}

export interface ObstacleEntry {
  type: string;
  distance: string;
  direction: string;
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
  distance: string;
  objectId: string;
}

// ==================== OBJECT TRACKER ====================

export class ObjectTracker {
  trackedObjects: Map<string, TrackedObject> = new Map();
  private nextObjectId = 0;
  private decayThreshold = 5;
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
    trackedObjects: TrackedObject[]
  ): { riskLevel: RiskLevel; safeDirection: string; shouldTrigger: boolean } {
    const persistent = trackedObjects.filter((o) => o.isPersistent);
    if (persistent.length === 0) {
      return {
        riskLevel: this.transitionRisk(RiskLevel.SAFE),
        safeDirection: "forward",
        shouldTrigger: false,
      };
    }

    const blocked: Record<string, number> = { left: 0, forward: 0, right: 0 };
    let immediateFront = false;

    for (const obj of persistent) {
      const lastBbox = obj.bboxHistory[obj.bboxHistory.length - 1];
      if (!lastBbox) continue;
      const centerX = bboxCenter(lastBbox)[0];
      const areaRatio = bboxArea(lastBbox);

      const distance =
        areaRatio >= 0.24 ? "immediate" : areaRatio >= 0.08 ? "near" : "far";
      const weight = distance === "immediate" ? 2 : 1;

      let direction: string;
      if (centerX < 0.25) direction = "left";
      else if (centerX < 0.42) direction = "front-left";
      else if (centerX <= 0.58) direction = "front";
      else if (centerX <= 0.75) direction = "front-right";
      else direction = "right";

      if (direction === "left" || direction === "front-left") {
        blocked.left += weight;
      } else if (direction === "right" || direction === "front-right") {
        blocked.right += weight;
      } else {
        blocked.forward += weight;
        if (distance === "immediate") immediateFront = true;
      }
    }

    // Safe direction
    let safeDirection: string;
    if (immediateFront && blocked.left > 0 && blocked.right > 0) {
      safeDirection = "stop";
    } else {
      safeDirection = Object.entries(blocked).reduce((a, b) =>
        a[1] <= b[1] ? a : b
      )[0];
    }

    // Risk level
    const anyImmediate = persistent.some(
      (o) => o.bboxHistory.length > 0 && bboxArea(o.bboxHistory[o.bboxHistory.length - 1]) >= 0.24
    );
    const anyNear = persistent.some(
      (o) => o.bboxHistory.length > 0 && bboxArea(o.bboxHistory[o.bboxHistory.length - 1]) >= 0.08
    );

    let newRisk: RiskLevel;
    if (immediateFront && blocked.left > 0 && blocked.right > 0) {
      newRisk = RiskLevel.CRITICAL;
    } else if (immediateFront || (anyImmediate && blocked.forward > 0)) {
      newRisk = RiskLevel.DANGER;
    } else if (
      persistent.some(
        (o) => o.isPersistent && classifyMotion(o) === MotionState.APPROACHING
      )
    ) {
      newRisk = RiskLevel.DANGER;
    } else if (
      anyNear ||
      persistent.length >= 2 ||
      persistent.some((o) => o.smoothedConfidence > 0.7)
    ) {
      newRisk = RiskLevel.CAUTION;
    } else {
      newRisk = RiskLevel.SAFE;
    }

    const { risk: finalRisk, trigger: shouldTrigger } =
      this.applyHysteresis(newRisk);
    return { riskLevel: finalRisk, safeDirection, shouldTrigger };
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
    trackedObjects: TrackedObject[],
    safeDirection: string,
    forceNew = false
  ): { message: string; event: AlertTriggerEvent | null } {
    let message: string;
    let event: AlertTriggerEvent | null;

    const persistent = trackedObjects.filter((o) => o.isPersistent);

    if (riskLevel === RiskLevel.CRITICAL) {
      message = this.buildCriticalMessage(persistent, safeDirection);
      event = AlertTriggerEvent.OBSTACLE_APPROACHING;
    } else if (riskLevel === RiskLevel.DANGER) {
      message = this.buildDangerMessage(persistent, safeDirection);
      event = AlertTriggerEvent.OBSTACLE_PERSISTS;
    } else if (riskLevel === RiskLevel.CAUTION) {
      message = this.buildCautionMessage(persistent);
      event = AlertTriggerEvent.MOTION_DETECTED;
    } else {
      message = "Path looks clear. Continue forward.";
      event = AlertTriggerEvent.OBSTACLE_CLEARED;
    }

    // Dedup
    if (message === this.lastAlertMessage && !forceNew) {
      return { message: "", event: null };
    }
    this.lastAlertMessage = message;
    return { message, event };
  }

  private buildCriticalMessage(
    objects: TrackedObject[],
    direction: string
  ): string {
    const primary = objects[0]?.className ?? "obstacle";
    const turnHint: Record<string, string> = {
      left: "Turn left immediately.",
      right: "Turn right immediately.",
      forward: "Back up immediately.",
      stop: "Stop. You are blocked.",
    };
    return `CRITICAL. ${primary} blocking path. ${turnHint[direction] ?? `Move ${direction} immediately.`}`;
  }

  private buildDangerMessage(
    objects: TrackedObject[],
    direction: string
  ): string {
    if (objects.length === 0) return "Danger ahead. Proceed carefully.";
    const types = objects
      .slice(0, 2)
      .map((o) => o.className)
      .join(", ");
    const turnHint: Record<string, string> = {
      left: "Turn left carefully.",
      right: "Turn right carefully.",
      forward: "Continue forward with caution.",
      stop: "Stop and reassess.",
    };
    return `Danger: ${types} ahead. ${turnHint[direction] ?? `Move ${direction} carefully.`}`;
  }

  private buildCautionMessage(objects: TrackedObject[]): string {
    if (objects.length === 0) return "Caution. Possible obstacles detected.";
    if (objects.length === 1)
      return `Caution. ${objects[0].className} detected. Proceed slowly.`;
    return `Caution. Multiple obstacles detected (${objects.length}). Proceed slowly.`;
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

    // 1. Track objects across frames
    const tracked = this.tracker.update(rawDetections, this.frameIndex);

    // 2. Evaluate risk
    const { riskLevel, safeDirection, shouldTrigger } =
      this.riskEngine.evaluate(tracked);

    // 3. Generate alert
    const { message: alertMessage, event: alertEvent } =
      this.alertManager.generateAlert(
        riskLevel,
        tracked,
        safeDirection,
        shouldTrigger
      );

    const audioMessage =
      alertMessage || this.getDefaultMessage(riskLevel, safeDirection);

    // 4. Build obstacle + detection coord output
    const obstacles: ObstacleEntry[] = [];
    const detectionCoords: DetectionCoord[] = [];

    for (const obj of tracked) {
      if (!obj.isPersistent) continue;
      const lastBbox = obj.bboxHistory[obj.bboxHistory.length - 1];
      if (!lastBbox) continue;
      const areaRatio = bboxArea(lastBbox);
      const distance =
        areaRatio >= 0.24 ? "immediate" : areaRatio >= 0.08 ? "near" : "far";
      const cx = bboxCenter(lastBbox)[0];
      let direction: string;
      if (cx < 0.25) direction = "left";
      else if (cx < 0.42) direction = "front-left";
      else if (cx <= 0.58) direction = "front";
      else if (cx <= 0.75) direction = "front-right";
      else direction = "right";

      obstacles.push({
        type: obj.className,
        distance,
        direction,
        confidence: Math.round(obj.smoothedConfidence * 1000) / 1000,
        moving: obj.motionState,
        persistenceFrames: obj.visibilityStreak,
        objectId: obj.objectId,
      });

      detectionCoords.push({
        x1: Math.round(lastBbox.x1 * 10000) / 10000,
        y1: Math.round(lastBbox.y1 * 10000) / 10000,
        x2: Math.round(lastBbox.x2 * 10000) / 10000,
        y2: Math.round(lastBbox.y2 * 10000) / 10000,
        label: obj.className,
        confidence: Math.round(obj.smoothedConfidence * 100) / 100,
        distance,
        objectId: obj.objectId,
      });
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
    };
  }

  private getDefaultMessage(risk: RiskLevel, direction: string): string {
    switch (risk) {
      case RiskLevel.CRITICAL:
        return "CRITICAL. Stop immediately.";
      case RiskLevel.DANGER:
        return `Danger ahead. Move ${direction}.`;
      case RiskLevel.CAUTION:
        return "Caution. Obstacles nearby.";
      default:
        return "Path clear. Continue forward.";
    }
  }

  reset(): void {
    this.tracker.reset();
    this.riskEngine.currentRisk = RiskLevel.SAFE;
    this.frameIndex = 0;
  }
}
