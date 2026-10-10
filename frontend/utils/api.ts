/**
 * Centralized backend access for the VisionMitra app.
 *
 * The configured URL (`EXPO_PUBLIC_BACKEND_URL`) is tried first, followed by
 * development fallbacks that work on the Android emulator, iOS simulator, and
 * web. A request only moves on to the next candidate on a *network* error, so
 * real HTTP error responses (4xx/5xx) are surfaced immediately.
 */

import axios, { isAxiosError } from "axios";

export const API_PATH_PREFIX = "/api";
export const API_TIMEOUT = 10000;

/** Hosts reachable from an emulator/simulator during local development. */
const DEV_FALLBACK_URLS = [
  "http://10.0.2.2:8001", // Android emulator -> host machine
  "http://127.0.0.1:8001", // iOS simulator
  "http://localhost:8001", // web / desktop
];

function normalizeBaseUrl(url?: string): string {
  return (url || "").trim().replace(/\/$/, "");
}

/** Ordered list of backend base URLs to try, without the `/api` suffix. */
export function getBackendCandidates(): string[] {
  const configured = normalizeBaseUrl(process.env.EXPO_PUBLIC_BACKEND_URL);
  return Array.from(new Set([configured, ...DEV_FALLBACK_URLS].filter(Boolean)));
}

/** The preferred backend base URL (configured URL, or first fallback). */
export function getBackendBaseUrl(): string {
  return getBackendCandidates()[0];
}

/** True when the error is a connectivity failure rather than an HTTP response. */
export function isNetworkError(error: unknown): boolean {
  return isAxiosError(error) && !error.response;
}

/** Runs `executor` against each backend candidate until one succeeds. */
export async function requestWithFallback<T>(
  executor: (baseUrl: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (const baseUrl of getBackendCandidates()) {
    try {
      return await executor(baseUrl);
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Backend unavailable");
}

export interface ApiRequestOptions {
  /** HTTP method (defaults to GET). */
  method?: "get" | "post" | "patch" | "put" | "delete";
  /** Path after `/api`, e.g. `/users` or `/detect-obstacles`. */
  path: string;
  /** JSON request body. */
  data?: unknown;
  /** Query parameters. */
  params?: Record<string, unknown>;
  /** Request timeout in milliseconds. */
  timeout?: number;
}

/**
 * Performs a JSON request against the VisionMitra API with backend fallback.
 * Resolves to the parsed response body.
 */
export async function apiRequest<T>({
  method = "get",
  path,
  data,
  params,
  timeout = API_TIMEOUT,
}: ApiRequestOptions): Promise<T> {
  return requestWithFallback(async (baseUrl) => {
    const response = await axios.request<T>({
      baseURL: `${baseUrl}${API_PATH_PREFIX}`,
      url: path,
      method,
      data,
      params,
      timeout,
    });
    return response.data;
  });
}
