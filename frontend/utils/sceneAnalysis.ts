/**
 * On-Device Scene Analysis
 * ========================
 * Lightweight scene analysis that runs WITHOUT any ML model.
 * Detects walls, flat surfaces, and close objects using image statistics.
 * TypeScript port of analyze_scene_proximity() from server.py.
 *
 * Uses raw pixel data from camera frames — works offline, no WiFi.
 */

export interface ProximityResult {
  isObstructed: boolean;
  obstructionConfidence: number;
  reason: string;
}

/**
 * Analyze raw RGBA pixel data for proximity/wall detection.
 * @param pixels - Uint8Array of RGBA pixel data (from ImageData or camera frame)
 * @param width - Frame width in pixels
 * @param height - Frame height in pixels
 */
export function analyzeSceneProximity(
  pixels: Uint8Array,
  width: number,
  height: number
): ProximityResult {
  if (!pixels || pixels.length === 0) {
    return { isObstructed: false, obstructionConfidence: 0, reason: "no_frame" };
  }

  const scores: number[] = [];

  // --- 1. Edge density: walls/flat surfaces have very few edges ---
  const edgeDensity = computeEdgeDensity(pixels, width, height);
  if (edgeDensity < 0.02) scores.push(0.7);
  else if (edgeDensity < 0.04) scores.push(0.4);
  else scores.push(0.0);

  // --- 2. Color uniformity in center 60% of frame ---
  const stdDev = computeCenterStdDev(pixels, width, height);
  if (stdDev < 15) scores.push(0.8);
  else if (stdDev < 25) scores.push(0.5);
  else if (stdDev < 40) scores.push(0.2);
  else scores.push(0.0);

  // --- 3. Blur detection (Laplacian variance approximation) ---
  const laplacianVar = computeLaplacianVariance(pixels, width, height);
  if (laplacianVar < 50) scores.push(0.7);
  else if (laplacianVar < 150) scores.push(0.3);
  else scores.push(0.0);

  // --- 4. Dominant color coverage ---
  const maxCoverage = computeDominantColorCoverage(pixels, width, height);
  if (maxCoverage > 0.6) scores.push(0.7);
  else if (maxCoverage > 0.4) scores.push(0.3);
  else scores.push(0.0);

  // Aggregate
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  if (avgScore >= 0.45) {
    let reason: string;
    if (edgeDensity < 0.02 && stdDev < 20) reason = "wall_or_flat_surface";
    else if (laplacianVar < 50) reason = "very_close_object";
    else reason = "large_uniform_surface";

    return {
      isObstructed: true,
      obstructionConfidence: Math.round(avgScore * 1000) / 1000,
      reason,
    };
  }

  return { isObstructed: false, obstructionConfidence: 0, reason: "clear" };
}

// Convert RGBA pixel to grayscale
function toGray(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Approximate edge density using a simple Sobel-like gradient.
 * Operates on a heavily downsampled version for speed.
 */
function computeEdgeDensity(
  pixels: Uint8Array,
  width: number,
  height: number
): number {
  // Downsample to ~80px wide for speed on React Native
  const scale = Math.max(1, Math.floor(width / 80));
  const sw = Math.floor(width / scale);
  const sh = Math.floor(height / scale);

  // Build grayscale grid
  const gray = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const srcY = y * scale;
    const srcRow = srcY * width;
    for (let x = 0; x < sw; x++) {
      const idx = (srcRow + x * scale) * 4;
      // Fast integer grayscale: (r*77 + g*150 + b*29) >> 8
      gray[y * sw + x] = (pixels[idx] * 77 + pixels[idx + 1] * 150 + pixels[idx + 2] * 29) >> 8;
    }
  }

  // Simplified gradient magnitude (avoid sqrt — use abs sum)
  let edgeCount = 0;
  const threshold = 40;
  for (let y = 1; y < sh - 1; y++) {
    const yw = y * sw;
    const ymw = (y - 1) * sw;
    const ypw = (y + 1) * sw;
    for (let x = 1; x < sw - 1; x++) {
      const gx =
        -gray[ymw + x - 1] + gray[ymw + x + 1] -
        2 * gray[yw + x - 1] + 2 * gray[yw + x + 1] -
        gray[ypw + x - 1] + gray[ypw + x + 1];

      const gy =
        -gray[ymw + x - 1] - 2 * gray[ymw + x] - gray[ymw + x + 1] +
        gray[ypw + x - 1] + 2 * gray[ypw + x] + gray[ypw + x + 1];

      // Use abs sum instead of sqrt for speed
      const mag = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
      if (mag > threshold) edgeCount++;
    }
  }

  return edgeCount / ((sw - 2) * (sh - 2));
}

/**
 * Compute standard deviation of pixel values in the center 60% of the frame.
 * Low stddev = uniform surface (wall).
 */
function computeCenterStdDev(
  pixels: Uint8Array,
  width: number,
  height: number
): number {
  const cy1 = Math.floor(height * 0.2);
  const cy2 = Math.floor(height * 0.8);
  const cx1 = Math.floor(width * 0.2);
  const cx2 = Math.floor(width * 0.8);

  // Sample every 6th pixel for speed
  const step = 6;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = cy1; y < cy2; y += step) {
    const rowOff = y * width;
    for (let x = cx1; x < cx2; x += step) {
      const idx = (rowOff + x) * 4;
      const g = (pixels[idx] * 77 + pixels[idx + 1] * 150 + pixels[idx + 2] * 29) >> 8;
      sum += g;
      sumSq += g * g;
      count++;
    }
  }

  if (count === 0) return 255;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Approximate Laplacian variance (blur detection).
 * Low variance = blurry = something very close to camera.
 */
function computeLaplacianVariance(
  pixels: Uint8Array,
  width: number,
  height: number
): number {
  // Downsample to ~60px wide for speed
  const scale = Math.max(1, Math.floor(width / 60));
  const sw = Math.floor(width / scale);
  const sh = Math.floor(height / scale);

  const gray = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const srcY = y * scale;
    const srcRow = srcY * width;
    for (let x = 0; x < sw; x++) {
      const idx = (srcRow + x * scale) * 4;
      gray[y * sw + x] = (pixels[idx] * 77 + pixels[idx + 1] * 150 + pixels[idx + 2] * 29) >> 8;
    }
  }

  // Laplacian kernel: [0,1,0; 1,-4,1; 0,1,0]
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < sh - 1; y++) {
    const yw = y * sw;
    for (let x = 1; x < sw - 1; x++) {
      const lap =
        gray[(y - 1) * sw + x] +
        gray[(y + 1) * sw + x] +
        gray[yw + x - 1] +
        gray[yw + x + 1] -
        4 * gray[yw + x];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 999;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/**
 * Check if one color dominates >40-60% of center region.
 * Indicates wall or large uniform surface.
 */
function computeDominantColorCoverage(
  pixels: Uint8Array,
  width: number,
  height: number
): number {
  const cy1 = Math.floor(height * 0.2);
  const cy2 = Math.floor(height * 0.8);
  const cx1 = Math.floor(width * 0.2);
  const cx2 = Math.floor(width * 0.8);

  // Quantize colors to 8 bins per channel (512 total buckets)
  // Use a flat array instead of Map for speed
  const buckets = new Uint16Array(512);
  const step = 8; // larger step for speed
  let total = 0;

  for (let y = cy1; y < cy2; y += step) {
    const rowOff = y * width;
    for (let x = cx1; x < cx2; x += step) {
      const idx = (rowOff + x) * 4;
      const qr = pixels[idx] >> 5;       // /32 via bit shift
      const qg = pixels[idx + 1] >> 5;
      const qb = pixels[idx + 2] >> 5;
      const key = (qr << 6) | (qg << 3) | qb;
      buckets[key]++;
      total++;
    }
  }

  if (total === 0) return 0;
  let maxCount = 0;
  for (let i = 0; i < 512; i++) {
    if (buckets[i] > maxCount) maxCount = buckets[i];
  }
  return maxCount / total;
}

/**
 * Helper: convert proximity result into a synthetic RawDetection
 * for feeding into the detection pipeline (mimics backend behavior).
 */
export function proximitySyntheticDetection(
  result: ProximityResult,
  frameWidth: number,
  frameHeight: number
): { className: string; confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } } | null {
  if (!result.isObstructed) return null;

  const labelMap: Record<string, string> = {
    wall_or_flat_surface: "wall",
    very_close_object: "close obstacle",
    large_uniform_surface: "large surface",
  };

  return {
    className: labelMap[result.reason] ?? "obstacle",
    confidence: Math.min(0.9, result.obstructionConfidence + 0.25),
    bbox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
  };
}
