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

/**
 * Decode a base64 JPEG image to RGBA pixel data.
 * Uses jpeg-js for proper JPEG decoding on React Native.
 *
 * @param base64 - Base64 encoded JPEG string (without data URI prefix)
 * @returns RGBA pixel data, actual width, actual height
 */
export async function decodeBase64ToPixels(
  base64: string
): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
  try {
    // Attempt 1: Try react-native-skia for fastest pixel access
    try {
      const Skia = require("@shopify/react-native-skia");
      const data = Skia.Skia.Data.fromBase64(base64);
      const image = Skia.Skia.Image.MakeImageFromEncoded(data);
      if (image) {
        const w = image.width();
        const h = image.height();
        const pixels = image.readPixels(0, 0, {
          width: w,
          height: h,
          colorType: 4, // RGBA_8888
          alphaType: 1, // Unpremul
        });
        if (pixels) {
          return { pixels: new Uint8Array(pixels), width: w, height: h };
        }
      }
    } catch {
      // Skia not available — fall through to jpeg-js
    }

    // Attempt 2: Use jpeg-js for proper JPEG decoding (pure JS)
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Proper JPEG decode — returns real RGBA pixel data
    const decoded = jpegDecode(bytes, {
      useTArray: true,   // return Uint8Array instead of Buffer
      formatAsRGBA: true, // RGBA output
      maxMemoryUsageInMB: 64,
    });

    if (!decoded || !decoded.data || decoded.width === 0) {
      console.warn("[IMAGE-UTIL] jpeg-js decode returned empty result");
      return null;
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
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(Math.min(binaryStr.length, 1024)); // Only need headers
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return parseJpegDimensions(bytes);
  } catch {
    return null;
  }
}
