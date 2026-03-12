/**
 * Image Utilities for On-Device Detection
 * ========================================
 * Decode camera frames to raw pixel data for on-device processing.
 * No network calls — everything runs locally.
 */

import { decode as jpegDecode } from "jpeg-js";
import { Buffer } from "buffer";

// Polyfill Buffer globally for jpeg-js
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}

// Target size for detection - YOLO uses 320x320, keep small for speed
const TARGET_WIDTH = 320;
const TARGET_HEIGHT = 320;

/**
 * Decode a base64 JPEG image to RGBA pixel data.
 * Uses jpeg-js for proper JPEG decoding on React Native.
 * Automatically downsamples large images during decode to save memory.
 *
 * @param base64 - Base64 encoded JPEG string (without data URI prefix)
 * @returns RGBA pixel data, actual width, actual height
 */
export async function decodeBase64ToPixels(
  base64: string
): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
  try {
    // Buffer.from is substantially faster than atob + manual byte copying on Hermes.
    const bytes = Buffer.from(base64, "base64");

    // Check dimensions from JPEG header
    const dims = parseJpegDimensions(bytes);
    
    // Calculate downscale factor if image is too large
    // jpeg-js doesn't support scaling, so we'll decode then downsample
    // But we can avoid decoding huge images entirely
    if (dims && (dims.width > 2000 || dims.height > 2000)) {
      // Image is very large - use expo-image-manipulator if available
      try {
        const { manipulateAsync, SaveFormat } = require("expo-image-manipulator");
        const dataUri = `data:image/jpeg;base64,${base64}`;
        const result = await manipulateAsync(
          dataUri,
          [{ resize: { width: TARGET_WIDTH } }],
          { format: SaveFormat.JPEG, base64: true }
        );
        if (result.base64) {
          // Recursively decode the resized image
          return decodeBase64ToPixels(result.base64);
        }
      } catch {
        // expo-image-manipulator not available, continue with jpeg-js
      }
    }

    // Decode with jpeg-js - increase memory limit substantially
    // A 4000x3000 RGBA image = 48MB, plus decode overhead
    const decoded = jpegDecode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 256, // Increased from 64
    });

    if (!decoded || !decoded.data || decoded.width === 0) {
      console.warn("[IMAGE-UTIL] jpeg-js decode returned empty result");
      return null;
    }

    // If decoded image is still large, downsample it
    if (decoded.width > TARGET_WIDTH || decoded.height > TARGET_HEIGHT) {
      const downsampled = downsampleRGBA(
        new Uint8Array(decoded.data),
        decoded.width,
        decoded.height,
        TARGET_WIDTH,
        TARGET_HEIGHT
      );
      return downsampled;
    }

    return {
      pixels: new Uint8Array(decoded.data),
      width: decoded.width,
      height: decoded.height,
    };
  } catch (e) {
    console.warn("[IMAGE-UTIL] Failed to decode image:", e);
    return null;
  }
}

/**
 * Downsample RGBA pixel data to target dimensions.
 * Uses nearest-neighbor for speed.
 */
function downsampleRGBA(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number
): { pixels: Uint8Array; width: number; height: number } {
  // Maintain aspect ratio
  const scale = Math.max(srcW / maxW, srcH / maxH);
  const dstW = Math.floor(srcW / scale);
  const dstH = Math.floor(srcH / scale);
  
  const dst = new Uint8Array(dstW * dstH * 4);
  
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.floor(y * scale);
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.floor(x * scale);
      const srcIdx = (srcY * srcW + srcX) * 4;
      const dstIdx = (y * dstW + x) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }
  
  return { pixels: dst, width: dstW, height: dstH };
}

/**
 * Parse JPEG dimensions from the Start Of Frame (SOF) marker.
 */
function parseJpegDimensions(
  data: Uint8Array
): { width: number; height: number } | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < data.length - 1) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = data[offset + 1];
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = (data[offset + 5] << 8) | data[offset + 6];
      const width = (data[offset + 7] << 8) | data[offset + 8];
      return { width, height };
    }

    const len = (data[offset + 2] << 8) | data[offset + 3];
    offset += 2 + len;
  }

  return null;
}

// approximatePixelsFromJpeg removed — using jpeg-js for proper JPEG decoding

/**
 * Get image dimensions from a base64 JPEG without full decode.
 */
export function getJpegDimensions(
  base64: string
): { width: number; height: number } | null {
  try {
    const bytes = Buffer.from(base64, "base64").subarray(0, 2048);
    return parseJpegDimensions(bytes);
  } catch {
    return null;
  }
}
