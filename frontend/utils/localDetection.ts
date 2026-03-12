/**
 * On-Device Detection Service
 * ============================
 * Runs the FULL detection pipeline on Android — NO server, NO WiFi.
 *
 * Architecture:
 *   Camera Frame → ONNX YOLO inference (on-device) → Detection Pipeline → Result
 *   Camera Frame → Scene Analysis (pure JS)         → Detection Pipeline → Result
 *
 * Two detection sources, merged before pipeline processing:
 * 1. YOLO via onnxruntime-react-native (object detection)
 * 2. Scene Analysis (wall/surface/proximity detection — fills YOLO blind spot)
 */

import { Platform } from "react-native";
import {
  RobustDetectionPipeline,
  COCO_CLASSES,
  MOBILITY_RELEVANT_CLASSES,
  getFailsafeResponse,
  type RawDetection,
  type DetectionFrame,
} from "./detectionPipeline";
import {
  analyzeSceneProximity,
  proximitySyntheticDetection,
  type ProximityResult,
} from "./sceneAnalysis";

// ==================== TYPES ====================

export interface LocalDetectionResult extends DetectionFrame {
  timings: {
    preprocessMs: number;
    inferenceMs: number;
    sceneAnalysisMs: number;
    pipelineMs: number;
    totalMs: number;
  };
  modelLoaded: boolean;
  sceneAnalysis: ProximityResult;
}

type OnnxSession = {
  run: (feeds: Record<string, any>) => Promise<Record<string, any>>;
};

// ==================== ONNX RUNTIME LOADER ====================

let onnxSession: OnnxSession | null = null;
let onnxLoadAttempted = false;
let onnxLoadError: string | null = null;

/**
 * Try to load ONNX Runtime and the YOLO model.
 * Falls back gracefully if onnxruntime-react-native is not available
 * (e.g. running in Expo Go without native build).
 */
async function loadOnnxModel(): Promise<boolean> {
  if (onnxSession) return true;
  if (onnxLoadAttempted) return false;
  onnxLoadAttempted = true;

  try {
    let ort: any = null;
    try {
      ort = require("onnxruntime-react-native");
    } catch (_reqErr) {
      throw new Error("ONNX native module failed to load (Expo Go?)");
    }
    if (!ort || !ort.InferenceSession) {
      throw new Error("ONNX native binding not available (Expo Go?)");
    }

    const { Asset } = require("expo-asset");

    // Load model from assets
    const [asset] = await Asset.loadAsync(
      require("../assets/yolov8n.onnx")
    );

    // CRITICAL: On Android, ONNX Runtime needs a raw file path, not a file:// URI.
    let modelPath = asset.localUri || asset.uri;
    if (Platform.OS === "android" && modelPath.startsWith("file://")) {
      modelPath = modelPath.replace("file://", "");
    }

    console.log("[LOCAL-DETECT] Loading ONNX model from:", modelPath);
    onnxSession = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    console.log("[LOCAL-DETECT] ONNX model loaded successfully");
    return true;
  } catch (e: any) {
    onnxLoadError = e.message || String(e);
    console.warn(
      "[LOCAL-DETECT] ONNX not available, using scene analysis only:",
      onnxLoadError
    );
    return false;
  }
}

// ==================== IMAGE PREPROCESSING ====================

const MODEL_INPUT_SIZE = 320;

/**
 * Decode base64 JPEG and create YOLO input tensor.
 * Returns Float32Array in NCHW format [1, 3, 320, 320], normalized [0,1].
 *
 * Uses a minimal JPEG→pixel approach. For maximum performance on a hackathon
 * timeline, we downsample by taking a grid of pixels from the base64 data.
 */
function preprocessImageForYolo(
  pixels: Uint8Array,
  srcWidth: number,
  srcHeight: number
): Float32Array {
  const S = MODEL_INPUT_SIZE;
  const tensor = new Float32Array(1 * 3 * S * S);

  // Bilinear-ish resample (nearest-neighbor for speed)
  const scaleX = srcWidth / S;
  const scaleY = srcHeight / S;

  for (let y = 0; y < S; y++) {
    const srcY = Math.min(Math.floor(y * scaleY), srcHeight - 1);
    for (let x = 0; x < S; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), srcWidth - 1);
      const srcIdx = (srcY * srcWidth + srcX) * 4; // RGBA

      const r = pixels[srcIdx] / 255.0;
      const g = pixels[srcIdx + 1] / 255.0;
      const b = pixels[srcIdx + 2] / 255.0;

      // NCHW layout: [batch, channel, height, width]
      tensor[0 * S * S + y * S + x] = r; // R channel
      tensor[1 * S * S + y * S + x] = g; // G channel
      tensor[2 * S * S + y * S + x] = b; // B channel
    }
  }

  return tensor;
}

// ==================== YOLO OUTPUT PARSING ====================

/**
 * Parse YOLOv8 ONNX output tensor into RawDetection[].
 * YOLOv8 output shape: [1, 84, 2100] for 320x320 input (80 classes + 4 bbox)
 * Transposed: each of 2100 detections has [x_center, y_center, w, h, cls0..cls79]
 */
function parseYoloOutput(
  outputData: Float32Array,
  numDetections: number,
  confThreshold: number,
  frameWidth: number,
  frameHeight: number
): RawDetection[] {
  const detections: RawDetection[] = [];
  const numClasses = 80;

  // Output is [1, 84, numDetections] — need to transpose to [numDetections, 84]
  for (let d = 0; d < numDetections; d++) {
    // Extract bbox (first 4 values for this detection)
    const xCenter = outputData[0 * numDetections + d];
    const yCenter = outputData[1 * numDetections + d];
    const w = outputData[2 * numDetections + d];
    const h = outputData[3 * numDetections + d];

    // Find best class
    let maxConf = 0;
    let maxClassId = 0;
    for (let c = 0; c < numClasses; c++) {
      const conf = outputData[(4 + c) * numDetections + d];
      if (conf > maxConf) {
        maxConf = conf;
        maxClassId = c;
      }
    }

    if (maxConf < confThreshold) continue;

    const className = COCO_CLASSES[maxClassId] || `class_${maxClassId}`;
    if (!MOBILITY_RELEVANT_CLASSES.has(className)) continue;

    // Convert from pixel coords (320x320) to normalized [0,1]
    const x1 = Math.max(0, (xCenter - w / 2) / MODEL_INPUT_SIZE);
    const y1 = Math.max(0, (yCenter - h / 2) / MODEL_INPUT_SIZE);
    const x2 = Math.min(1, (xCenter + w / 2) / MODEL_INPUT_SIZE);
    const y2 = Math.min(1, (yCenter + h / 2) / MODEL_INPUT_SIZE);

    detections.push({
      classId: maxClassId,
      className,
      confidence: maxConf,
      bbox: { x1, y1, x2, y2 },
      frameWidth,
      frameHeight,
    });
  }

  // Simple NMS: remove overlapping detections of same class
  return simpleNMS(detections, 0.5);
}

function simpleNMS(
  detections: RawDetection[],
  iouThreshold: number
): RawDetection[] {
  // Sort by confidence descending
  detections.sort((a, b) => b.confidence - a.confidence);
  const kept: RawDetection[] = [];

  for (const det of detections) {
    let dominated = false;
    for (const k of kept) {
      if (k.className === det.className && computeIoU(k.bbox, det.bbox) > iouThreshold) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(det);
  }
  return kept;
}

function computeIoU(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number }
): number {
  const interX1 = Math.max(a.x1, b.x1);
  const interY1 = Math.max(a.y1, b.y1);
  const interX2 = Math.min(a.x2, b.x2);
  const interY2 = Math.min(a.y2, b.y2);
  const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
  const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
  const union = aArea + bArea - interArea;
  return union > 0 ? interArea / union : 0;
}

// ==================== PIPELINE SINGLETON ====================

const pipelines = new Map<string, RobustDetectionPipeline>();

function getPipeline(sessionId: string): RobustDetectionPipeline {
  if (!pipelines.has(sessionId)) {
    pipelines.set(sessionId, new RobustDetectionPipeline());
  }
  return pipelines.get(sessionId)!;
}

export function clearPipeline(sessionId: string): void {
  pipelines.delete(sessionId);
}

// ==================== MAIN DETECTION FUNCTION ====================

const CONF_THRESHOLD = 0.25;

// Max resolution for scene analysis — larger images get downsampled
const MAX_SCENE_WIDTH = 320;
const MAX_SCENE_HEIGHT = 240;

/**
 * Downsample RGBA pixel data for faster scene analysis.
 */
function downsamplePixels(
  pixels: Uint8Array,
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number
): { pixels: Uint8Array; width: number; height: number } {
  if (srcW <= maxW && srcH <= maxH) {
    return { pixels, width: srcW, height: srcH };
  }
  const scale = Math.max(srcW / maxW, srcH / maxH);
  const dstW = Math.floor(srcW / scale);
  const dstH = Math.floor(srcH / scale);
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.floor(y * scale);
    const srcRow = srcY * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const srcIdx = (srcRow + Math.floor(x * scale)) * 4;
      const dstIdx = (dstRow + x) * 4;
      out[dstIdx] = pixels[srcIdx];
      out[dstIdx + 1] = pixels[srcIdx + 1];
      out[dstIdx + 2] = pixels[srcIdx + 2];
      out[dstIdx + 3] = 255;
    }
  }
  return { pixels: out, width: dstW, height: dstH };
}

/**
 * Run full detection pipeline on-device.
 *
 * @param pixels - RGBA pixel data from camera frame (Uint8Array)
 * @param width - Frame width
 * @param height - Frame height
 * @param sessionId - Session identifier for temporal tracking
 *
 * All processing happens locally. No network calls. No database calls.
 */
export async function detectObstaclesLocal(
  pixels: Uint8Array,
  width: number,
  height: number,
  sessionId: string = "default"
): Promise<LocalDetectionResult> {
  const t0 = Date.now();
  let rawDetections: RawDetection[] = [];
  let modelLoaded = false;

  // ---- STEP 1: Try ONNX YOLO inference ----
  const t1 = Date.now();
  let tPreprocess = 0;
  let tInference = 0;

  try {
    const loaded = await loadOnnxModel();
    modelLoaded = loaded;

    if (loaded && onnxSession) {
      // Preprocess: pixels → [1, 3, 320, 320] tensor
      const tp0 = Date.now();
      const inputTensor = preprocessImageForYolo(pixels, width, height);
      tPreprocess = Date.now() - tp0;

      // Run inference
      const ti0 = Date.now();
      let ort: any = null;
      try { ort = require("onnxruntime-react-native"); } catch (_e) { /* skip */ }
      if (!ort || !ort.Tensor) throw new Error("ONNX native module unavailable");
      const feeds = {
        images: new ort.Tensor("float32", inputTensor, [
          1,
          3,
          MODEL_INPUT_SIZE,
          MODEL_INPUT_SIZE,
        ]),
      };
      const results = await onnxSession.run(feeds);

      // Parse output — YOLOv8 output key is typically "output0"
      const outputKey = Object.keys(results)[0];
      const outputTensor = results[outputKey];
      const outputData = outputTensor.data as Float32Array;
      const numDetections = outputTensor.dims[2] || 2100;

      tInference = Date.now() - ti0;

      rawDetections = parseYoloOutput(
        outputData,
        numDetections,
        CONF_THRESHOLD,
        width,
        height
      );
    }
  } catch (e: any) {
    console.warn("[LOCAL-DETECT] YOLO inference failed:", e.message);
  }

  // ---- STEP 2: Scene proximity analysis (always runs, fills YOLO blind spots) ----
  // Downsample for scene analysis to keep it fast (<100ms)
  const tScene0 = Date.now();
  const scene = downsamplePixels(pixels, width, height, MAX_SCENE_WIDTH, MAX_SCENE_HEIGHT);
  const proximityResult = analyzeSceneProximity(scene.pixels, scene.width, scene.height);
  const tScene = Date.now() - tScene0;

  // Inject synthetic detection if wall/surface detected and YOLO found ≤1 object
  const hasLargeCentralDetection = rawDetections.some((det) => {
    const widthNorm = Math.max(0, det.bbox.x2 - det.bbox.x1);
    const heightNorm = Math.max(0, det.bbox.y2 - det.bbox.y1);
    const areaNorm = widthNorm * heightNorm;
    const centerX = (det.bbox.x1 + det.bbox.x2) / 2;
    return areaNorm >= 0.18 && centerX >= 0.3 && centerX <= 0.7;
  });

  if (proximityResult.isObstructed && !hasLargeCentralDetection) {
    const synthetic = proximitySyntheticDetection(
      proximityResult,
      width,
      height
    );
    if (synthetic) {
      rawDetections.push({
        classId: 9999,
        className: synthetic.className,
        confidence: synthetic.confidence,
        bbox: synthetic.bbox,
        frameWidth: width,
        frameHeight: height,
      });
    }
  }

  // ---- STEP 3: Run through detection pipeline ----
  const tPipe0 = Date.now();
  const pipeline = getPipeline(sessionId);
  const result = pipeline.processFrame(rawDetections, width, height);
  const tPipe = Date.now() - tPipe0;

  const totalMs = Date.now() - t0;

  return {
    ...result,
    timings: {
      preprocessMs: tPreprocess,
      inferenceMs: tInference,
      sceneAnalysisMs: tScene,
      pipelineMs: tPipe,
      totalMs,
    },
    modelLoaded,
    sceneAnalysis: proximityResult,
  };
}

/**
 * Initialize the detection service (preload ONNX model).
 * Call this on app startup so the first detection isn't slow.
 */
export async function initDetectionService(): Promise<{
  modelLoaded: boolean;
  error: string | null;
}> {
  const loaded = await loadOnnxModel();
  return { modelLoaded: loaded, error: onnxLoadError };
}
