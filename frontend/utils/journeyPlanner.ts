/**
 * Journey Planner Module
 * 
 * Implements cost-free heuristic public transport routing using:
 * - OpenStreetMap Overpass API
 * - Geographic distance heuristics
 * - Segmented navigation planning
 */

import axios from "axios";

// ==================== TYPES & INTERFACES ====================

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface TransportStop {
  id: string | number;
  name: string;
  type: string; // "Bus" | "Station" | "Tram" | "Transit"
  lat: number;
  lon: number;
  distance?: number;
  service_name?: string;
  route_refs?: string[];
}

export type SegmentType = "WALK" | "TRANSPORT";

export interface NavigationSegment {
  type: SegmentType;
  start_coordinates: Coordinates;
  end_coordinates: Coordinates;
  instruction: string;
  distance: number;
  start_location_name?: string;
  end_location_name?: string;
  transport_type?: string;
  segment_index: number;
}

export interface JourneyPlan {
  origin_coordinates: Coordinates;
  destination_coordinates: Coordinates;
  selected_origin_stop: TransportStop | null;
  selected_destination_stop: TransportStop | null;
  segments: NavigationSegment[];
  total_distance: number;
  estimated_time: number; // in minutes
  journey_type: "DIRECT_WALK" | "TRANSPORT"; // fallback indicator
}

export interface StopPair {
  origin_stop: TransportStop;
  destination_stop: TransportStop;
  total_cost: number;
  walk_to_origin: number;
  transport_distance: number;
  walk_to_destination: number;
  selected_service?: string;
}

// ==================== CONFIGURATION ====================

const OVERPASS_API_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
const DEFAULT_SEARCH_RADIUS = 800; // meters
const SEARCH_RADIUS_STEPS = [800, 1500, 2500];
const MAX_STOPS_PER_QUERY = 80;
const WALKING_SPEED = 1.4; // m/s (average walking speed)
const TRANSPORT_SPEED = 8.3; // m/s (approx 30 km/h for buses/trams)
const MAX_WALKING_DISTANCE = 3000; // meters - use direct walk if destination closer
const MAX_FIRST_LAST_MILE_DISTANCE = 2200; // meters - cap for walking to/from stops
const REQUEST_TIMEOUT = 10000; // ms
const OVERPASS_REQUEST_INTERVAL_MS = 900;
const OVERPASS_MAX_RETRIES_PER_ENDPOINT = 2;

// Cache for session-duration stop data
let stopCache: Map<string, TransportStop[]> = new Map();
let lastOverpassRequestAt = 0;

// ==================== UTILITY FUNCTIONS ====================

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Calculate initial bearing from point A to point B
 * Returns bearing in degrees (0-360, where 0=North, 90=East, 180=South, 270=West)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Get compass direction label from bearing
 */
export function bearingToCompass(bearing: number): string {
  const directions = [
    "North", "North-East", "East", "South-East",
    "South", "South-West", "West", "North-West"
  ];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

/**
 * Get relative direction instruction based on user's heading and target bearing
 * deviceHeading: current compass heading of the device (0-360)
 * targetBearing: bearing from current position to target (0-360)
 */
export function getRelativeDirection(deviceHeading: number, targetBearing: number): string {
  let diff = ((targetBearing - deviceHeading) + 360) % 360;
  
  if (diff <= 30 || diff >= 330) return "Continue straight ahead";
  if (diff > 30 && diff <= 60) return "Turn slightly right";
  if (diff > 60 && diff <= 120) return "Turn right";
  if (diff > 120 && diff <= 150) return "Turn sharp right";
  if (diff > 150 && diff <= 210) return "Turn around";
  if (diff > 210 && diff <= 240) return "Turn sharp left";
  if (diff > 240 && diff <= 300) return "Turn left";
  return "Turn slightly left";
}

/**
 * Estimate travel time based on distance and mode
 */
export function estimateTravelTime(distance: number, mode: SegmentType): number {
  const speed = mode === "WALK" ? WALKING_SPEED : TRANSPORT_SPEED;
  return Math.round(distance / speed / 60); // Convert to minutes
}

/**
 * Generate cache key for stop queries
 */
function getCacheKey(lat: number, lon: number, radius: number): string {
  return `${lat.toFixed(4)}_${lon.toFixed(4)}_${radius}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOverpassStatus(status?: number): boolean {
  if (!status) return true;
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function throttleOverpassRequests(): Promise<void> {
  const now = Date.now();
  const waitMs = OVERPASS_REQUEST_INTERVAL_MS - (now - lastOverpassRequestAt);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastOverpassRequestAt = Date.now();
}

async function postOverpass(query: string): Promise<any | null> {
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_API_URLS) {
    for (let attempt = 1; attempt <= OVERPASS_MAX_RETRIES_PER_ENDPOINT; attempt++) {
      try {
        await throttleOverpassRequests();
        const response = await axios.post(endpoint, query, {
          headers: {
            "Content-Type": "text/plain",
            "Accept": "application/json",
          },
          timeout: REQUEST_TIMEOUT,
        });
        return response.data;
      } catch (error) {
        lastError = error;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const retryable = isRetryableOverpassStatus(status);

        console.warn(
          `[JourneyPlanner] Overpass request failed (endpoint=${endpoint}, attempt=${attempt}, status=${status || "n/a"})`
        );

        if (!retryable) {
          break;
        }

        const backoffMs = 700 * attempt;
        await sleep(backoffMs);
      }
    }
  }

  if (axios.isAxiosError(lastError)) {
    const status = lastError.response?.status;
    console.warn(`[JourneyPlanner] Overpass unavailable after retries (status=${status || "n/a"})`);
  } else if (lastError) {
    console.warn("[JourneyPlanner] Overpass unavailable after retries");
  }

  return null;
}

function normalizeServiceName(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getServiceNameFromTags(tags: Record<string, string> = {}): string | undefined {
  return normalizeServiceName(tags.operator) || normalizeServiceName(tags.network);
}

function getRouteRefsFromTags(tags: Record<string, string> = {}): string[] {
  const refs = (tags.route_ref || tags.ref || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(refs));
}

// ==================== OVERPASS API FUNCTIONS ====================

/**
 * Fetch nearby transport stops from OpenStreetMap Overpass API
 * Uses caching to avoid redundant requests
 */
export async function fetchNearbyStops(
  latitude: number,
  longitude: number,
  radius: number = DEFAULT_SEARCH_RADIUS
): Promise<TransportStop[]> {
  const cacheKey = getCacheKey(latitude, longitude, radius);

  // Check cache first
  if (stopCache.has(cacheKey)) {
    console.log(`[JourneyPlanner] Using cached stops for ${cacheKey}`);
    return stopCache.get(cacheKey)!;
  }

  try {
    const query = `
      [out:json][timeout:25];
      (
        node["highway"="bus_stop"](around:${radius},${latitude},${longitude});
        node["amenity"="bus_station"](around:${radius},${latitude},${longitude});
        node["public_transport"="platform"](around:${radius},${latitude},${longitude});
        node["railway"="station"](around:${radius},${latitude},${longitude});
        node["railway"="halt"](around:${radius},${latitude},${longitude});
        node["railway"="tram_stop"](around:${radius},${latitude},${longitude});
      );
      out body ${MAX_STOPS_PER_QUERY};
    `;

    console.log(`[JourneyPlanner] Fetching stops at (${latitude}, ${longitude}) r=${radius}m`);

    const data = await postOverpass(query);

    if (!data || !data.elements) {
      console.warn("[JourneyPlanner] No data from Overpass API");
      return [];
    }

    const stopById: Map<string | number, TransportStop> = new Map();

    for (const el of data.elements) {
      if (typeof el?.lat !== "number" || typeof el?.lon !== "number") continue;

      const tags = el.tags || {};
      const type = tags.railway === "tram_stop"
        ? "Tram"
        : tags.railway === "station" || tags.railway === "halt"
        ? "Station"
        : tags.highway === "bus_stop" || tags.amenity === "bus_station" || tags.public_transport
        ? "Bus"
        : "Transit";

      const serviceName = getServiceNameFromTags(tags);
      const routeRefs = getRouteRefsFromTags(tags);

      const stop: TransportStop = {
        id: el.id,
        name: tags?.name || `Unnamed ${type} Stop`,
        type,
        lat: el.lat,
        lon: el.lon,
        distance: calculateDistance(latitude, longitude, el.lat, el.lon),
        service_name: serviceName,
        route_refs: routeRefs,
      };

      stopById.set(el.id, stop);
    }

    const stops = Array.from(stopById.values());

    // Sort by distance
    stops.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    const limitedStops = stops.slice(0, MAX_STOPS_PER_QUERY);

    // Cache result
    stopCache.set(cacheKey, limitedStops);

    console.log(`[JourneyPlanner] Found ${limitedStops.length} stops`);
    return limitedStops;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    console.warn(`[JourneyPlanner] Overpass fetch failed (status=${status || "n/a"})`);
    return [];
  }
}

/**
 * Clear stop cache (useful for new sessions)
 */
export function clearStopCache(): void {
  stopCache.clear();
  console.log("[JourneyPlanner] Stop cache cleared");
}

// ==================== ROUTE COMPUTATION ====================

/**
 * Compute best stop pair using minimum cost heuristic
 * Cost = walk_to_origin + transport_distance + walk_from_destination
 */
export function computeBestStopPair(
  originStops: TransportStop[],
  destinationStops: TransportStop[],
  userLocation: Coordinates,
  finalDestination: Coordinates,
  maxFirstLastMileDistance: number = MAX_FIRST_LAST_MILE_DISTANCE
): StopPair | null {
  if (originStops.length === 0 || destinationStops.length === 0) {
    console.warn("[JourneyPlanner] No stops available for pairing");
    return null;
  }

  let bestPair: StopPair | null = null;
  let minCost = Infinity;

  // Evaluate all possible stop combinations
  for (const originStop of originStops) {
    const walkToOrigin = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      originStop.lat,
      originStop.lon
    );

    // Skip if origin stop too far
    if (walkToOrigin > maxFirstLastMileDistance) continue;

    for (const destStop of destinationStops) {
      // Skip same stop
      if (originStop.id === destStop.id) continue;

      const transportDistance = calculateDistance(
        originStop.lat,
        originStop.lon,
        destStop.lat,
        destStop.lon
      );

      const walkToDestination = calculateDistance(
        destStop.lat,
        destStop.lon,
        finalDestination.latitude,
        finalDestination.longitude
      );

      // Skip if destination stop too far from final destination
      if (walkToDestination > maxFirstLastMileDistance) continue;

      const hasBothServices = Boolean(originStop.service_name && destStop.service_name);
      const serviceMismatchPenalty =
        hasBothServices && originStop.service_name !== destStop.service_name ? 1200 : 0;

      // Total cost calculation
      const totalCost =
        walkToOrigin + transportDistance + walkToDestination + serviceMismatchPenalty;

      if (totalCost < minCost) {
        minCost = totalCost;
        bestPair = {
          origin_stop: originStop,
          destination_stop: destStop,
          total_cost: totalCost,
          walk_to_origin: walkToOrigin,
          transport_distance: transportDistance,
          walk_to_destination: walkToDestination,
          selected_service: originStop.service_name || destStop.service_name,
        };
      }
    }
  }

  if (bestPair) {
    console.log(
      `[JourneyPlanner] Best pair: ${bestPair.origin_stop.name} → ${bestPair.destination_stop.name} (cost: ${Math.round(bestPair.total_cost)}m)`
    );
  }

  return bestPair;
}

// ==================== SEGMENT GENERATION ====================

/**
 * Build navigation segments from stop pair
 */
export function buildJourneySegments(
  userLocation: Coordinates,
  finalDestination: Coordinates,
  stopPair: StopPair
): NavigationSegment[] {
  const segments: NavigationSegment[] = [];
  const servicePrefix = stopPair.selected_service ? `${stopPair.selected_service} ` : "";
  const routeLabel =
    stopPair.origin_stop.route_refs && stopPair.origin_stop.route_refs.length > 0
      ? ` (routes ${stopPair.origin_stop.route_refs.slice(0, 3).join(", ")})`
      : "";

  // Segment 1: Walk to origin stop
  segments.push({
    type: "WALK",
    start_coordinates: userLocation,
    end_coordinates: {
      latitude: stopPair.origin_stop.lat,
      longitude: stopPair.origin_stop.lon,
    },
    instruction: `Walk to ${stopPair.origin_stop.name}`,
    distance: stopPair.walk_to_origin,
    start_location_name: "Your Location",
    end_location_name: stopPair.origin_stop.name,
    segment_index: 0,
  });

  // Segment 2: Transport journey
  segments.push({
    type: "TRANSPORT",
    start_coordinates: {
      latitude: stopPair.origin_stop.lat,
      longitude: stopPair.origin_stop.lon,
    },
    end_coordinates: {
      latitude: stopPair.destination_stop.lat,
      longitude: stopPair.destination_stop.lon,
    },
    instruction: `Take ${servicePrefix}${stopPair.origin_stop.type} from ${stopPair.origin_stop.name} to ${stopPair.destination_stop.name}${routeLabel}`,
    distance: stopPair.transport_distance,
    start_location_name: stopPair.origin_stop.name,
    end_location_name: stopPair.destination_stop.name,
    transport_type: stopPair.origin_stop.type,
    segment_index: 1,
  });

  // Segment 3: Walk to final destination
  segments.push({
    type: "WALK",
    start_coordinates: {
      latitude: stopPair.destination_stop.lat,
      longitude: stopPair.destination_stop.lon,
    },
    end_coordinates: finalDestination,
    instruction: `Walk to your destination`,
    distance: stopPair.walk_to_destination,
    start_location_name: stopPair.destination_stop.name,
    end_location_name: "Destination",
    segment_index: 2,
  });

  return segments;
}

/**
 * Build direct walking segment (fallback)
 */
export function buildDirectWalkSegment(
  userLocation: Coordinates,
  finalDestination: Coordinates
): NavigationSegment {
  const distance = calculateDistance(
    userLocation.latitude,
    userLocation.longitude,
    finalDestination.latitude,
    finalDestination.longitude
  );

  return {
    type: "WALK",
    start_coordinates: userLocation,
    end_coordinates: finalDestination,
    instruction: "Walk directly to your destination",
    distance,
    start_location_name: "Your Location",
    end_location_name: "Destination",
    segment_index: 0,
  };
}

// ==================== MAIN JOURNEY PLANNER ====================

/**
 * Complete journey planning algorithm
 * Returns JourneyPlan with segments for execution
 */
export async function planJourney(
  userLocation: Coordinates,
  destinationLocation: Coordinates
): Promise<JourneyPlan> {
  console.log("[JourneyPlanner] Planning journey...");
  console.log(`  Origin: (${userLocation.latitude}, ${userLocation.longitude})`);
  console.log(`  Destination: (${destinationLocation.latitude}, ${destinationLocation.longitude})`);

  // Calculate direct distance
  const directDistance = calculateDistance(
    userLocation.latitude,
    userLocation.longitude,
    destinationLocation.latitude,
    destinationLocation.longitude
  );

  console.log(`  Direct distance: ${directDistance}m`);

  // FALLBACK 1: If destination very close, use direct walk
  if (directDistance <= MAX_WALKING_DISTANCE) {
    console.log("[JourneyPlanner] Using direct walk (destination nearby)");
    const segment = buildDirectWalkSegment(userLocation, destinationLocation);
    return {
      origin_coordinates: userLocation,
      destination_coordinates: destinationLocation,
      selected_origin_stop: null,
      selected_destination_stop: null,
      segments: [segment],
      total_distance: directDistance,
      estimated_time: estimateTravelTime(directDistance, "WALK"),
      journey_type: "DIRECT_WALK",
    };
  }

  try {
    let bestPair: StopPair | null = null;
    let originStops: TransportStop[] = [];
    let destinationStops: TransportStop[] = [];

    for (const radius of SEARCH_RADIUS_STEPS) {
      console.log(`[JourneyPlanner] Fetching stops with radius ${radius}m...`);

      const candidateOriginStops = await fetchNearbyStops(
        userLocation.latitude,
        userLocation.longitude,
        radius
      );
      const candidateDestinationStops = await fetchNearbyStops(
        destinationLocation.latitude,
        destinationLocation.longitude,
        radius
      );

      if (candidateOriginStops.length === 0 || candidateDestinationStops.length === 0) {
        continue;
      }

      const candidatePair = computeBestStopPair(
        candidateOriginStops,
        candidateDestinationStops,
        userLocation,
        destinationLocation,
        Math.min(MAX_FIRST_LAST_MILE_DISTANCE, Math.round(radius * 1.5))
      );

      if (candidatePair) {
        bestPair = candidatePair;
        originStops = candidateOriginStops;
        destinationStops = candidateDestinationStops;
        console.log(`[JourneyPlanner] Selected stop pair using ${radius}m radius`);
        break;
      }
    }

    // FALLBACK 2: No stops or no valid pair found
    if (originStops.length === 0 || destinationStops.length === 0 || !bestPair) {
      console.warn("[JourneyPlanner] No valid public transport path found, using direct walk");
      const segment = buildDirectWalkSegment(userLocation, destinationLocation);
      return {
        origin_coordinates: userLocation,
        destination_coordinates: destinationLocation,
        selected_origin_stop: null,
        selected_destination_stop: null,
        segments: [segment],
        total_distance: directDistance,
        estimated_time: estimateTravelTime(directDistance, "WALK"),
        journey_type: "DIRECT_WALK",
      };
    }

    // STEP 4: Build journey segments
    console.log("[JourneyPlanner] Step 4: Building journey segments...");
    const segments = buildJourneySegments(userLocation, destinationLocation, bestPair);

    // Calculate total distance and time
    const totalDistance = segments.reduce((sum, seg) => sum + seg.distance, 0);
    const estimatedTime = segments.reduce(
      (sum, seg) => sum + estimateTravelTime(seg.distance, seg.type),
      0
    );

    console.log(`[JourneyPlanner] Journey complete: ${segments.length} segments, ${totalDistance}m, ~${estimatedTime}min`);

    return {
      origin_coordinates: userLocation,
      destination_coordinates: destinationLocation,
      selected_origin_stop: bestPair.origin_stop,
      selected_destination_stop: bestPair.destination_stop,
      segments,
      total_distance: totalDistance,
      estimated_time: estimatedTime,
      journey_type: "TRANSPORT",
    };
  } catch (error) {
    console.error("[JourneyPlanner] Error during planning:", error);
    // FALLBACK 4: Error occurred
    const segment = buildDirectWalkSegment(userLocation, destinationLocation);
    return {
      origin_coordinates: userLocation,
      destination_coordinates: destinationLocation,
      selected_origin_stop: null,
      selected_destination_stop: null,
      segments: [segment],
      total_distance: directDistance,
      estimated_time: estimateTravelTime(directDistance, "WALK"),
      journey_type: "DIRECT_WALK",
    };
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Format time for display
 */
export function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}min`;
}

/**
 * Generate audio instruction for segment
 */
export function generateAudioInstruction(segment: NavigationSegment): string {
  const distanceStr = formatDistance(segment.distance);
  const timeStr = formatTime(estimateTravelTime(segment.distance, segment.type));

  if (segment.type === "WALK") {
    return `${segment.instruction}. Distance ${distanceStr}, approximately ${timeStr}.`;
  } else {
    return `${segment.instruction}. Journey ${distanceStr}, approximately ${timeStr}.`;
  }
}
