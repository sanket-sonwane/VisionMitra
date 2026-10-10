/**
 * Shared API payload types for the VisionMitra backend.
 *
 * These mirror the Pydantic models in `backend/app/models.py`.
 */

import type { JourneyPlan } from "./journeyPlanner";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type WarningLevel = "safe" | "caution" | "danger" | "critical";

export interface Obstacle {
  type: string;
  distance: string;
  direction: string;
  confidence: number;
  moving: string;
  persistence_frames: number;
  object_id: string;
}

export interface ObstacleDetectionResult {
  obstacles: Obstacle[];
  safe_direction: string | null;
  warning_level: WarningLevel;
  audio_message: string;
}

export interface NavigationSession {
  id: string;
  user_id: string;
  start_location: Coordinates;
  destination?: Coordinates | null;
  destination_name?: string | null;
  journey_plan?: JourneyPlan | null;
  current_segment_index?: number;
  status: string;
  mode: string;
  started_at: string;
  completed_at?: string | null;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  created_at: string;
}

export interface AlertRecord {
  id: string;
  user_id: string;
  session_id?: string | null;
  alert_type: string;
  message: string;
  priority: string;
  timestamp: string;
}
