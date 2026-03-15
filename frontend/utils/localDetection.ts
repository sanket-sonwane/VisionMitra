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
    corridorMs: number;
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

interface PreprocessMeta {
  scale: number;
  padX: number;
  padY: number;
}

// Class-specific floor to reduce noisy low-confidence labels while keeping
// critical mobility classes responsive.
const CLASS_MIN_CONF: Record<string, number> = {
  person: 0.2,
  bicycle: 0.22,
  motorcycle: 0.22,
  car: 0.22,
  bus: 0.22,
  truck: 0.22,
  train: 0.22,
  dog: 0.24,
  cat: 0.26,
  chair: 0.32,
  bench: 0.32,
  laptop: 0.45,
  book: 0.5,
  handbag: 0.48,
};

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
): { tensor: Float32Array; meta: PreprocessMeta } {
  const S = MODEL_INPUT_SIZE;
  const tensor = new Float32Array(1 * 3 * S * S);

  // Letterbox: preserve aspect ratio and pad with neutral gray.
  const scale = Math.min(S / srcWidth, S / srcHeight);
  const resizedW = Math.max(1, Math.round(srcWidth * scale));
  const resizedH = Math.max(1, Math.round(srcHeight * scale));
  const padX = Math.floor((S - resizedW) / 2);
  const padY = Math.floor((S - resizedH) / 2);
  const padValue = 114 / 255.0;

  // Fill with padding color first.
  for (let i = 0; i < S * S; i++) {
    tensor[0 * S * S + i] = padValue;
    tensor[1 * S * S + i] = padValue;
    tensor[2 * S * S + i] = padValue;
  }

  // Bilinear resize into letterbox region.
  for (let y = 0; y < resizedH; y++) {
    const dstY = y + padY;
    const srcYFloat = (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.min(srcHeight - 1, Math.floor(srcYFloat)));
    const y1 = Math.max(0, Math.min(srcHeight - 1, y0 + 1));
    const wy = Math.max(0, Math.min(1, srcYFloat - y0));

    for (let x = 0; x < resizedW; x++) {
      const dstX = x + padX;
      const srcXFloat = (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.min(srcWidth - 1, Math.floor(srcXFloat)));
      const x1 = Math.max(0, Math.min(srcWidth - 1, x0 + 1));
      const wx = Math.max(0, Math.min(1, srcXFloat - x0));

      const p00 = (y0 * srcWidth + x0) * 4;
      const p01 = (y0 * srcWidth + x1) * 4;
      const p10 = (y1 * srcWidth + x0) * 4;
      const p11 = (y1 * srcWidth + x1) * 4;

      const w00 = (1 - wx) * (1 - wy);
      const w01 = wx * (1 - wy);
      const w10 = (1 - wx) * wy;
      const w11 = wx * wy;

      const r = (pixels[p00] * w00 + pixels[p01] * w01 + pixels[p10] * w10 + pixels[p11] * w11) / 255.0;
      const g = (pixels[p00 + 1] * w00 + pixels[p01 + 1] * w01 + pixels[p10 + 1] * w10 + pixels[p11 + 1] * w11) / 255.0;
      const b = (pixels[p00 + 2] * w00 + pixels[p01 + 2] * w01 + pixels[p10 + 2] * w10 + pixels[p11 + 2] * w11) / 255.0;

      // NCHW layout: [batch, channel, height, width]
      tensor[0 * S * S + dstY * S + dstX] = r;
      tensor[1 * S * S + dstY * S + dstX] = g;
      tensor[2 * S * S + dstY * S + dstX] = b;
    }
  }

  return {
    tensor,
    meta: { scale, padX, padY },
  };
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
  frameHeight: number,
  prepMeta: PreprocessMeta
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

    const className = COCO_CLASSES[maxClassId] || `class_${maxClassId}`;
    if (!MOBILITY_RELEVANT_CLASSES.has(className)) continue;

    const classMinConf = CLASS_MIN_CONF[className] ?? confThreshold;
    const effectiveMinConf = Math.max(confThreshold, classMinConf);
    if (maxConf < effectiveMinConf) continue;

    // Undo letterbox transform back to original frame space.
    const modelX1 = xCenter - w / 2;
    const modelY1 = yCenter - h / 2;
    const modelX2 = xCenter + w / 2;
    const modelY2 = yCenter + h / 2;

    const srcX1 = (modelX1 - prepMeta.padX) / prepMeta.scale;
    const srcY1 = (modelY1 - prepMeta.padY) / prepMeta.scale;
    const srcX2 = (modelX2 - prepMeta.padX) / prepMeta.scale;
    const srcY2 = (modelY2 - prepMeta.padY) / prepMeta.scale;

    const x1 = Math.max(0, Math.min(1, srcX1 / frameWidth));
    const y1 = Math.max(0, Math.min(1, srcY1 / frameHeight));
    const x2 = Math.max(0, Math.min(1, srcX2 / frameWidth));
    const y2 = Math.max(0, Math.min(1, srcY2 / frameHeight));

    if (x2 <= x1 || y2 <= y1) continue;

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

const CONF_THRESHOLD = 0.18;

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
      const preprocessed = preprocessImageForYolo(pixels, width, height);
      tPreprocess = Date.now() - tp0;

      // Run inference
      const ti0 = Date.now();
      let ort: any = null;
      try { ort = require("onnxruntime-react-native"); } catch (_e) { /* skip */ }
      if (!ort || !ort.Tensor) throw new Error("ONNX native module unavailable");
      const feeds = {
        images: new ort.Tensor("float32", preprocessed.tensor, [
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
        height,
        preprocessed.meta
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

  if (__DEV__ && result.corridorAnalysisMs > 5) {
    console.warn(
      `[LOCAL-DETECT] Corridor analysis exceeded target: ${result.corridorAnalysisMs.toFixed(2)}ms`
    );
  }

  const totalMs = Date.now() - t0;

  return {
    ...result,
    timings: {
      preprocessMs: tPreprocess,
      inferenceMs: tInference,
      sceneAnalysisMs: tScene,
      corridorMs: result.corridorAnalysisMs,
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
