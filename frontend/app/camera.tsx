import { StyleSheet, View, TouchableOpacity, Text, Alert, Platform, ScrollView, Image } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useState, useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as ImageManipulator from "expo-image-manipulator";
import { useRouter } from "expo-router";
import axios from "axios";
import { useStore } from "@/store";
import type { MessageKey } from "@/localization/messages";
import { isMessageKey, translate } from "@/localization/translate";
import {
  speakLocalizedMessage,
  speakLocalizedText,
  stopLocalizedSpeech,
} from "@/localization/speech";
import {
  calculateDistance,
  calculateBearing,
  bearingToCompass,
  getRelativeDirection,
  formatDistance,
  generateAudioInstruction,
  type NavigationSegment,
  type Coordinates,
} from "@/utils/journeyPlanner";
import {
  detectObstaclesLocal,
  initDetectionService,
  clearPipeline,
  type LocalDetectionResult,
} from "@/utils/localDetection";
import { decodeBase64ToPixels } from "@/utils/imageUtils";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const SEGMENT_COMPLETION_THRESHOLD = 50; // meters - consider segment complete when within this distance
const CONTINUOUS_TARGET_INTERVAL_MS = 350;
const CONTINUOUS_MIN_INTERVAL_MS = 140;

export default function Camera() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [locationPermission, setLocationPermission] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<any>(null);
  const [isActive, setIsActive] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [currentSegment, setCurrentSegment] = useState<NavigationSegment | null>(null);
  const [segmentProgress, setSegmentProgress] = useState<number>(0);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [navigationDirection, setNavigationDirection] = useState<string>("");
  const cameraRef = useRef<any>(null);
  const analysisInterval = useRef<any>(null);
  const isContinuousRef = useRef(false);
  const consecutiveAnalysisFailures = useRef(0);
  const locationInterval = useRef<any>(null);
  const headingSubscription = useRef<any>(null);
  const lastDirectionAnnounce = useRef<number>(0);
  const [showDebugImage, setShowDebugImage] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [modelStatus, setModelStatus] = useState<string>("loading");
  const [pictureSize, setPictureSize] = useState<string | undefined>("640x480");
  const { userId, isOnlineMode, currentSession, setCurrentSession } = useStore();

  const speakMessageKey = (messageKey: MessageKey, rate: number = 1.0) => {
    speakLocalizedMessage(messageKey, { rate });
  };

  const speakText = (text: string, rate: number = 1.0) => {
    speakLocalizedText(text, { rate });
  };

  const resolveAlertMessageKey = (
    rawMessage: unknown,
    warningLevel?: string,
    safeDirection?: string
  ): MessageKey => {
    if (typeof rawMessage === "string" && rawMessage.length > 0) {
      if (isMessageKey(rawMessage)) return rawMessage;

      const normalized = rawMessage.toLowerCase();
      if (normalized.includes("calibrat")) return "CAMERA_CALIBRATING";
      if (normalized.includes("crowd") && normalized.includes("left")) return "CROWD_LEFT";
      if (normalized.includes("crowd") && normalized.includes("right")) return "CROWD_RIGHT";
      if (normalized.includes("blocking")) return "OBSTACLE_BLOCKING";
      if (normalized.includes("person")) return "PERSON_AHEAD";
      if (normalized.includes("path clear") || normalized.includes("continue forward")) return "PATH_CLEAR";
      if (normalized.includes("caution") || normalized.includes("side obstacle")) return "CAUTION_SIDE_OBSTACLE";
    }

    if (warningLevel === "critical") {
      if (safeDirection === "left") return "OBSTACLE_AHEAD_LEFT";
      if (safeDirection === "right") return "OBSTACLE_AHEAD_RIGHT";
      return "OBSTACLE_BLOCKING";
    }

    if (warningLevel === "danger") return "PERSON_AHEAD";
    if (warningLevel === "caution") return "CAUTION_SIDE_OBSTACLE";
    return "PATH_CLEAR";
  };

  useEffect(() => {
    requestLocationPermission();
    initializeNavigation();
    // Preload the on-device YOLO model so first detection is fast
    initDetectionService()
      .then(({ modelLoaded, error }) => {
        setModelStatus(modelLoaded ? "ready" : "scene-only");
        if (!modelLoaded) {
          console.warn("[CAMERA] ONNX model not loaded, using scene analysis:", error);
        }
      })
      .catch((error) => {
        console.warn("[CAMERA] Detection service init failed, using scene analysis only:", error);
        setModelStatus("scene-only");
      });
    
    return () => {
      if (analysisInterval.current) {
        clearInterval(analysisInterval.current);
      }
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
      if (headingSubscription.current) {
        headingSubscription.current.remove();
      }
      clearPipeline(currentSession?.id || "default");
      stopLocalizedSpeech();
    };
  }, []);

  // Update current segment when session changes
  useEffect(() => {
    if (currentSession?.journey_plan) {
      updateCurrentSegment();
    }
  }, [currentSession]);

  const initializeNavigation = () => {
    if (currentSession?.journey_plan) {
      speakMessageKey("SEGMENTED_NAVIGATION_ACTIVE");
      updateCurrentSegment();
      startLocationTracking();
      startHeadingTracking();
    } else {
      speakMessageKey("CAMERA_MODE_ACTIVE");
    }
  };

  const handleCameraReady = async () => {
    if (!cameraRef.current?.getAvailablePictureSizes) return;

    try {
      const sizes: string[] = await cameraRef.current.getAvailablePictureSizes();
      console.log("[CAMERA] Available picture sizes:", sizes);
      const parsed = sizes
        .map((value) => {
          const match = value.match(/(\d+)x(\d+)/);
          if (!match) return null;
          const width = Number(match[1]);
          const height = Number(match[2]);
          return { value, width, height, area: width * height };
        })
        .filter((item): item is { value: string; width: number; height: number; area: number } => Boolean(item))
        .sort((a, b) => a.area - b.area);

      if (parsed.length === 0) return;

      const preferred =
        parsed.find((size) => size.width >= 640 && size.height >= 480 && size.width <= 1280) ??
        parsed.find((size) => size.width >= 640 && size.height >= 480) ??
        parsed[0];

      setPictureSize((current) => {
        if (current === preferred.value) return current;
        console.log("[CAMERA] Using picture size:", preferred.value);
        return preferred.value;
      });
    } catch (error) {
      console.warn("[CAMERA] Failed to query picture sizes:", error);
    }
  };

  const updateCurrentSegment = () => {
    if (!currentSession?.journey_plan) return;

    const segmentIndex = currentSession.current_segment_index || 0;
    const segments = currentSession.journey_plan.segments;

    if (segmentIndex < segments.length) {
      const segment = segments[segmentIndex];
      setCurrentSegment(segment);
      speakText(generateAudioInstruction(segment));
    } else {
      // Journey completed
      speakMessageKey("DESTINATION_REACHED");
      completeNavigation();
    }
  };

  const startLocationTracking = () => {
    // Track location every 5 seconds to check segment progress and update compass
    locationInterval.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({});
        const coords: Coordinates = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setCurrentLocation(coords);
        checkSegmentCompletion(coords);
        updateNavigationDirection(coords);
      } catch (error) {
        console.error("Location tracking error:", error);
      }
    }, 5000);
  };

  const startHeadingTracking = async () => {
    try {
      headingSubscription.current = await Location.watchHeadingAsync((heading) => {
        if (heading.trueHeading >= 0) {
          setDeviceHeading(heading.trueHeading);
        } else if (heading.magHeading >= 0) {
          setDeviceHeading(heading.magHeading);
        }
      });
    } catch (error) {
      console.warn("Compass heading not available:", error);
    }
  };

  const updateNavigationDirection = (coords: Coordinates) => {
    if (!currentSegment) return;

    const targetBearing = calculateBearing(
      coords.latitude,
      coords.longitude,
      currentSegment.end_coordinates.latitude,
      currentSegment.end_coordinates.longitude
    );

    let dirText = "";
    if (deviceHeading !== null && currentSegment.type === "WALK") {
      dirText = getRelativeDirection(deviceHeading, targetBearing);
    } else {
      dirText = `Head ${bearingToCompass(targetBearing)}`;
    }
    setNavigationDirection(dirText);

    // Voice announce direction every 20 seconds during walking
    const now = Date.now();
    if (currentSegment.type === "WALK" && dirText && now - lastDirectionAnnounce.current > 20000) {
      lastDirectionAnnounce.current = now;
      speakText(dirText);
    }
  };

  const checkSegmentCompletion = async (location: Coordinates) => {
    if (!currentSegment || !currentSession) return;

    const distanceToEnd = calculateDistance(
      location.latitude,
      location.longitude,
      currentSegment.end_coordinates.latitude,
      currentSegment.end_coordinates.longitude
    );

    // Update progress
    const totalDistance = currentSegment.distance;
    const progress = Math.max(0, Math.min(100, ((totalDistance - distanceToEnd) / totalDistance) * 100));
    setSegmentProgress(progress);

    // Check if segment completed
    if (distanceToEnd <= SEGMENT_COMPLETION_THRESHOLD) {
      await completeSegment();
    }
  };

  const completeSegment = async () => {
    if (!currentSession || !currentSegment) return;

    const nextSegmentIndex = (currentSession.current_segment_index || 0) + 1;
    const totalSegments = currentSession.journey_plan?.segments?.length || 0;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (nextSegmentIndex < totalSegments) {
      // Move to next segment - fire-and-forget backend update (non-blocking)
      axios.patch(
        `${BACKEND_URL}/api/navigation-sessions/${currentSession.id}`,
        null,
        {
          params: { current_segment_index: nextSegmentIndex },
          timeout: 3000,
        }
      ).catch((error) => {
        console.warn("Backend segment update failed (non-fatal):", error);
      });

      // Update local session immediately (don't wait for backend)
      const updatedSession = {
        ...currentSession,
        current_segment_index: nextSegmentIndex,
      };
      setCurrentSession(updatedSession);

      speakMessageKey("SEGMENT_COMPLETE");
      setSegmentProgress(0);
    } else {
      // All segments complete
      await completeNavigation();
    }
  };

  const completeNavigation = async () => {
    if (!currentSession) return;

    // Fire-and-forget backend update (non-blocking)
    axios.patch(
      `${BACKEND_URL}/api/navigation-sessions/${currentSession.id}`,
      null,
      {
        params: { status: "completed" },
        timeout: 3000,
      }
    ).catch((error) => {
      console.warn("Backend navigation complete failed (non-fatal):", error);
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    speakMessageKey("NAVIGATION_COMPLETE");
    
    // Clear session
    setCurrentSession(null);
    setCurrentSegment(null);
    
    // Stop tracking
    if (locationInterval.current) {
      clearInterval(locationInterval.current);
    }
  };

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationPermission(status === "granted");
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.message}>Requesting camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Ionicons name="close-circle" size={64} color="#F44336" />
          <Text style={styles.message}>Camera access is required</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const captureAndAnalyze = async () => {
    if (!cameraRef.current || isAnalyzing) return;

    const shouldLogPerf = __DEV__ && showDebugInfo;

    const totalStart = Date.now();
    try {
      setIsAnalyzing(true);
      // Skip haptics in continuous mode for speed
      if (!isContinuousRef.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        speakMessageKey("ANALYZING_SURROUNDINGS");
      }

      // Capture a smaller frame with enough detail for YOLO.
      const captureStart = Date.now();
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        base64: true,
        skipProcessing: true,
        exif: false,
      });
      const captureTime = Date.now() - captureStart;
      if (shouldLogPerf) {
        console.log(`[CAMERA] takePictureAsync: ${captureTime}ms`);
      }

      if (!photo.base64) {
        throw new Error("Failed to capture image");
      }

      // Prefer the native-captured base64. If the frame is still too large,
      // resize natively from the file URI before decoding in JS.
      let imageBase64 = photo.base64;

      const base64Length = photo.base64.length;
      const forcedWidth = pictureSize ? Number((pictureSize.match(/(\d+)x(\d+)/) || [])[1]) : NaN;
      const likelyLowRes = Number.isFinite(forcedWidth) && forcedWidth > 0 && forcedWidth <= 800;

      if (photo.uri && base64Length > 1200000 && !likelyLowRes) {
        try {
          const resizeStart = Date.now();
          const resized = await ImageManipulator.manipulateAsync(
            photo.uri,
            [{ resize: { width: 320 } }],
            { format: ImageManipulator.SaveFormat.JPEG, base64: true, compress: 0.7 }
          );
          if (shouldLogPerf) {
            console.log(`[CAMERA] ImageManipulator resize: ${Date.now() - resizeStart}ms`);
          }
          if (resized.base64) {
            imageBase64 = resized.base64;
          }
        } catch (resizeErr) {
          console.warn("[CAMERA] Image resize failed, using original:", resizeErr);
        }
      }

      let result: any = null;

      // Production mode: always run detection locally.
      // If ONNX is unavailable on a device, scene-analysis fallback still runs on-device.
      const decodeStart = Date.now();
      const decoded = await decodeBase64ToPixels(imageBase64);
      if (shouldLogPerf) {
        console.log(`[CAMERA] decodeBase64ToPixels: ${Date.now() - decodeStart}ms`);
      }
      if (decoded) {
        const sessionId = currentSession?.id || "default";
        const localResult = await detectObstaclesLocal(
          decoded.pixels, decoded.width, decoded.height, sessionId
        );
        const mode = localResult.modelLoaded ? "on-device" : "scene-only";
        result = {
          obstacles: localResult.obstacles,
          safe_direction: localResult.safeDirection,
          warning_level: localResult.riskLevel,
          audio_message_key: localResult.audioMessage || undefined,
          audio_message: localResult.audioMessage
            ? translate(localResult.audioMessage)
            : "",
          detection_coords: localResult.detectionCoords,
          debug_info: showDebugInfo ? {
            mode,
            model_loaded: localResult.modelLoaded,
            timings: localResult.timings,
            calibration_state: localResult.calibrationState,
            alert_priority: localResult.alertPriority,
            lane_counters: localResult.laneCounters,
            corridor_analysis_ms: localResult.corridorAnalysisMs,
            corridor_overlay: __DEV__ ? localResult.corridorDebugOverlay : null,
            frame_width: decoded.width,
            frame_height: decoded.height,
            scene_reason: localResult.sceneAnalysis.reason,
            scene_confidence: localResult.sceneAnalysis.obstructionConfidence,
            scene_metrics: localResult.sceneAnalysis.metrics,
            raw_detections_count: localResult.rawDetections.length,
            tracked_objects_count: localResult.trackedObjects.length,
            obstacles_count: localResult.obstacles.length,
            frame_index: localResult.frameIndex,
          } : null,
        };
      }

      if (result) {
        consecutiveAnalysisFailures.current = 0;
        const rawAlertValue =
          typeof result.audio_message_key === "string" && result.audio_message_key.length > 0
            ? result.audio_message_key
            : typeof result.audio_message === "string" && result.audio_message.length > 0
              ? result.audio_message
              : null;

        if (rawAlertValue) {
          const resolvedKey = resolveAlertMessageKey(
            rawAlertValue,
            result.warning_level,
            result.safe_direction
          );
          result.audio_message_key = resolvedKey;
          result.audio_message = translate(resolvedKey);
        } else {
          result.audio_message_key = undefined;
          result.audio_message = "";
        }

        setLastAnalysis(result);

        if (showDebugInfo) {
          console.log('[DETECT] Mode:', result.debug_info?.mode);
          console.log('[DETECT] Raw detections:', result.debug_info?.raw_detections_count ?? 0);
          console.log('[DETECT] Scene:', result.debug_info?.scene_reason, result.debug_info?.scene_confidence, result.debug_info?.scene_metrics);
          console.log('[DETECT] Obstacles:', JSON.stringify(result.obstacles));
          console.log('[DETECT] Risk:', result.warning_level);
        }

        // Haptic feedback based on warning level
        // Skip haptics in continuous mode for speed
        if (!isContinuousRef.current) {
          if (result.warning_level === "critical" || result.warning_level === "danger") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          } else if (result.warning_level === "caution") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }

        // Speak the audio message (only critical/danger in continuous mode)
        if (result.audio_message_key) {
          const isCalibrationPrompt = result.audio_message_key === "CAMERA_CALIBRATING";
          const shouldSpeak = !isContinuousRef.current || 
            result.warning_level === "critical" || 
            result.warning_level === "danger" ||
            isCalibrationPrompt;
          if (shouldSpeak) {
            speakMessageKey(result.audio_message_key, 1.1);
          }
        }
        
        // Log total time
        if (shouldLogPerf) {
          console.log(`[CAMERA] Total captureAndAnalyze: ${Date.now() - totalStart}ms`);
        }
      } else {
        if (!isContinuousRef.current) {
          speakMessageKey("ANALYSIS_UNAVAILABLE");
        }
        setLastAnalysis({
          warning_level: "caution",
          audio_message_key: "ANALYSIS_UNAVAILABLE",
          audio_message: translate("ANALYSIS_UNAVAILABLE"),
        });
      }

    } catch (error: any) {
      consecutiveAnalysisFailures.current += 1;
      console.error("Analysis error:", error);
      speakMessageKey("ANALYSIS_FAILED");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // Circuit breaker: avoid repeated crash loops on low-memory/low-end devices.
      if (isContinuousRef.current && consecutiveAnalysisFailures.current >= 3) {
        isContinuousRef.current = false;
        setIsActive(false);
        speakText("Continuous monitoring paused for stability. Please restart analysis.");
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderCorridorDebugOverlay = () => {
    if (!__DEV__ || !showDebugInfo) return null;

    const overlay = lastAnalysis?.debug_info?.corridor_overlay;
    const frameWidth = Number(lastAnalysis?.debug_info?.frame_width || 0);
    const frameHeight = Number(lastAnalysis?.debug_info?.frame_height || 0);

    if (!overlay || !frameWidth || !frameHeight) return null;

    const dots: any[] = [];

    const addSegmentDots = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      color: string,
      keyPrefix: string
    ) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.max(1, Math.floor(length / 24));

      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = a.x + dx * t;
        const y = a.y + dy * t;
        dots.push(
          <View
            key={`${keyPrefix}_${i}`}
            style={[
              styles.corridorDebugDot,
              {
                left: `${(x / frameWidth) * 100}%`,
                top: `${(y / frameHeight) * 100}%`,
                backgroundColor: color,
              },
            ]}
          />
        );
      }
    };

    const drawPolygon = (points: Array<{ x: number; y: number }>, color: string, keyPrefix: string) => {
      if (!Array.isArray(points) || points.length < 2) return;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        addSegmentDots(a, b, color, `${keyPrefix}_${i}`);
      }
    };

    drawPolygon(overlay.roi || [], "#00E676", "roi");
    drawPolygon(overlay.centerCorridor || [], "#4FC3F7", "center");

    (overlay.gridRows || []).forEach((row: Array<{ x: number; y: number }>, idx: number) => {
      if (row.length >= 2) {
        addSegmentDots(row[0], row[1], "#FFD54F", `grid_${idx}`);
      }
    });

    return <View style={styles.corridorDebugOverlay} pointerEvents="none">{dots}</View>;
  };

  const startContinuousAnalysis = () => {
    setIsActive(true);
    isContinuousRef.current = true;
    speakMessageKey("CONTINUOUS_MONITORING_STARTED");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Frame counter for timing
    let frameCount = 0;
    let loopStartTime = Date.now();

    // Optimized loop: minimal gap, track FPS
    const runLoop = async () => {
      while (isContinuousRef.current) {
        const frameStart = Date.now();
        await captureAndAnalyze();
        frameCount++;
        const frameTime = Date.now() - frameStart;
        
        // Keep debug logs sparse so Metro/IDE isn't overwhelmed in continuous mode.
        if (__DEV__ && showDebugInfo && frameCount % 20 === 0) {
          const elapsed = (Date.now() - loopStartTime) / 1000;
          const fps = frameCount / elapsed;
          console.log(`[CONTINUOUS] Frame ${frameCount}: ${frameTime}ms, Avg FPS: ${fps.toFixed(2)}`);
        }

        // Adaptive backoff for lower-end devices: avoid runaway CPU/memory pressure.
        const waitMs = Math.max(CONTINUOUS_MIN_INTERVAL_MS, CONTINUOUS_TARGET_INTERVAL_MS - frameTime);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    };
    runLoop();
  };

  const stopContinuousAnalysis = () => {
    setIsActive(false);
    isContinuousRef.current = false;
    speakMessageKey("CONTINUOUS_MONITORING_STOPPED");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    if (analysisInterval.current) {
      clearInterval(analysisInterval.current);
      analysisInterval.current = null;
    }
  };

  const getWarningColor = (level: string) => {
    switch (level) {
      case "critical": return "#B71C1C";
      case "danger": return "#F44336";
      case "caution": return "#FF9800";
      case "safe": return "#4CAF50";
      default: return "#2196F3";
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            stopContinuousAnalysis();
            stopLocalizedSpeech();
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Live Navigation</Text>
        <View style={styles.modeIndicator}>
          <View style={[styles.modeDot, { backgroundColor: modelStatus === "ready" ? "#4CAF50" : modelStatus === "scene-only" ? "#2196F3" : "#FF9800" }]} />
          <Text style={styles.modeText}>
            {modelStatus === "ready" ? "AI On-Device" : modelStatus === "scene-only" ? "Scene Only (Offline)" : "Loading..."}
          </Text>
        </View>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          ref={cameraRef}
          facing="back"
          pictureSize={pictureSize}
          onCameraReady={handleCameraReady}
        />

        <View style={styles.pathCorridorOverlay} pointerEvents="none">
          <View style={styles.pathCorridorLabelWrap}>
            <Text style={styles.pathCorridorLabel}>CENTER PATH</Text>
          </View>
          <View style={styles.pathCorridorFill} />
          <View style={styles.pathCorridorLeft} />
          <View style={styles.pathCorridorRight} />
          <View style={styles.pathCorridorCenterLine} />
        </View>

        {renderCorridorDebugOverlay()}

        {currentSegment && (
          <View style={styles.segmentOverlay}>
            <View style={[
              styles.segmentTypeIndicator,
              currentSegment.type === "WALK" ? styles.walkIndicator : styles.transportIndicator
            ]}>
              <Ionicons
                name={currentSegment.type === "WALK" ? "walk" : currentSegment.transport_type === "Bus" ? "bus" : "train"}
                size={20}
                color="#fff"
              />
              <Text style={styles.segmentTypeText}>
                {currentSegment.type === "WALK" ? "WALKING" : `${currentSegment.transport_type?.toUpperCase()}`}
              </Text>
            </View>
            <Text style={styles.segmentInstructionText}>{currentSegment.instruction}</Text>
            {navigationDirection ? (
              <View style={styles.compassRow}>
                <Ionicons name="compass" size={18} color="#4CAF50" />
                <Text style={styles.compassDirectionText}>{navigationDirection}</Text>
              </View>
            ) : null}
            <View style={styles.segmentProgressBar}>
              <View style={[styles.segmentProgressFill, { width: `${segmentProgress}%` }]} />
            </View>
            <Text style={styles.segmentDistanceText}>
              {formatDistance(currentSegment.distance)} • Segment {(currentSession?.current_segment_index || 0) + 1} of {currentSession?.journey_plan?.segments?.length || 1}
            </Text>
          </View>
        )}

        {lastAnalysis && lastAnalysis.debug_annotated_image && showDebugImage && (
          <View style={styles.debugImageOverlay}>
            <Image
              source={{ uri: `data:image/jpeg;base64,${lastAnalysis.debug_annotated_image}` }}
              style={styles.debugImage}
              resizeMode="contain"
            />
            <TouchableOpacity style={styles.closeDebugButton} onPress={() => setShowDebugImage(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Client-side bounding box overlay from detection_coords */}
        {lastAnalysis?.detection_coords && lastAnalysis.detection_coords.length > 0 && !showDebugImage && (
          <View style={styles.bboxOverlay} pointerEvents="none">
            {lastAnalysis.detection_coords.map((coord: any, idx: number) => {
              const distColor = coord.distance === "immediate" ? "#FF0000" : coord.distance === "near" ? "#FF9800" : "#4CAF50";
              return (
                <View
                  key={coord.object_id || idx}
                  style={[styles.bboxRect, {
                    left: `${coord.x1 * 100}%`,
                    top: `${coord.y1 * 100}%`,
                    width: `${(coord.x2 - coord.x1) * 100}%`,
                    height: `${(coord.y2 - coord.y1) * 100}%`,
                    borderColor: distColor,
                  }]}
                >
                  <View style={[styles.bboxLabel, { backgroundColor: distColor }]}>
                    <Text style={styles.bboxLabelText}>
                      {coord.label} {coord.confidence} [{coord.distance}]
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {lastAnalysis && (
          <View style={[styles.statusOverlay, { backgroundColor: getWarningColor(lastAnalysis.warning_level) + "CC" }]}>
            <Text style={styles.statusText}>{lastAnalysis.warning_level?.toUpperCase()}</Text>
            {lastAnalysis.obstacles && lastAnalysis.obstacles.length > 0 && (
              <Text style={styles.obstacleCount}>
                {lastAnalysis.obstacles.length} Obstacle{lastAnalysis.obstacles.length > 1 ? "s" : ""}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {/* Debug toggle buttons */}
        <View style={styles.debugToggleRow}>
          <TouchableOpacity
            style={[styles.debugToggleButton, showDebugImage && styles.debugToggleActive]}
            onPress={() => setShowDebugImage(!showDebugImage)}
          >
            <Ionicons name="image" size={16} color="#fff" />
            <Text style={styles.debugToggleText}>Boxes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.debugToggleButton, showDebugInfo && styles.debugToggleActive]}
            onPress={() => setShowDebugInfo(!showDebugInfo)}
          >
            <Ionicons name="bug" size={16} color="#fff" />
            <Text style={styles.debugToggleText}>Debug</Text>
          </TouchableOpacity>
        </View>

        {!isActive ? (
          <>
            <TouchableOpacity
              style={[styles.analyzeButton, isAnalyzing && styles.analyzeButtonDisabled]}
              onPress={captureAndAnalyze}
              disabled={isAnalyzing}
              onLongPress={() => speakMessageKey("ANALYZE_ONCE_HINT")}
            >
              <Ionicons name="scan" size={32} color="#fff" />
              <Text style={styles.buttonText}>
                {isAnalyzing ? "Analyzing..." : "Analyze Now"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.continuousButton}
              onPress={startContinuousAnalysis}
              onLongPress={() => speakMessageKey("START_MONITORING_HINT")}
            >
              <Ionicons name="play" size={32} color="#fff" />
              <Text style={styles.buttonText}>Start Monitoring</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopContinuousAnalysis}
            onLongPress={() => speakMessageKey("STOP_MONITORING_HINT")}
          >
            <Ionicons name="stop" size={32} color="#fff" />
            <Text style={styles.buttonText}>Stop Monitoring</Text>
          </TouchableOpacity>
        )}
      </View>

      {lastAnalysis && (
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>Last Analysis:</Text>
          <Text style={styles.resultMessage}>
            {lastAnalysis.audio_message_key && isMessageKey(lastAnalysis.audio_message_key)
              ? translate(lastAnalysis.audio_message_key)
              : lastAnalysis.audio_message}
          </Text>
          {lastAnalysis.obstacles && lastAnalysis.obstacles.length > 0 && (
            <View style={styles.obstacleList}>
              {lastAnalysis.obstacles.map((obs: any, idx: number) => (
                <Text key={idx} style={styles.obstacleItem}>
                  {obs.type} • {obs.distance} • {obs.direction} • lane:{obs.lane ?? "n/a"} • conf:{obs.confidence} • {obs.moving}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {showDebugInfo && lastAnalysis?.debug_info && (
        <ScrollView style={styles.debugInfoPanel}>
          <Text style={styles.debugInfoTitle}>On-Device Detection Telemetry</Text>
          <Text style={styles.debugInfoText}>
            YOLO model loaded: {String(lastAnalysis.debug_info.model_loaded ?? 'N/A')}
          </Text>
          <Text style={styles.debugInfoText}>
            Raw detections: {lastAnalysis.debug_info.raw_detections_count ?? 'N/A'}
          </Text>
          <Text style={styles.debugInfoText}>
            Tracked objects: {lastAnalysis.debug_info.tracked_objects_count ?? 'N/A'}
          </Text>
          <Text style={styles.debugInfoText}>
            Obstacles reported: {lastAnalysis.debug_info.obstacles_count ?? 'N/A'}
          </Text>
          <Text style={styles.debugInfoText}>
            Frame #{lastAnalysis.debug_info.frame_index ?? '?'}
          </Text>
          {lastAnalysis.debug_info.timings && (
            <Text style={styles.debugInfoText}>
              Preprocess: {lastAnalysis.debug_info.timings.preprocessMs ?? '?'}ms | 
              Inference: {lastAnalysis.debug_info.timings.inferenceMs ?? '?'}ms | 
              Scene: {lastAnalysis.debug_info.timings.sceneAnalysisMs ?? '?'}ms | 
                Corridor: {lastAnalysis.debug_info.timings.corridorMs ?? '?'}ms | 
              Pipeline: {lastAnalysis.debug_info.timings.pipelineMs ?? '?'}ms | 
              Total: {lastAnalysis.debug_info.timings.totalMs ?? '?'}ms
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  corridorDebugOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 7,
  },
  corridorDebugDot: {
    position: "absolute",
    width: 3,
    height: 3,
    borderRadius: 2,
    marginLeft: -1.5,
    marginTop: -1.5,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#1a1a1a",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#fff",
  },
  modeIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modeText: {
    fontSize: 12,
    color: "#B0B0B0",
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  statusOverlay: {
    position: "absolute",
    top: 20,
    left: 20,
    right: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  statusText: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
  },
  obstacleCount: {
    fontSize: 16,
    color: "#fff",
    marginTop: 4,
  },
  controls: {
    padding: 20,
    gap: 12,
  },
  analyzeButton: {
    backgroundColor: "#2196F3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    borderRadius: 16,
    gap: 12,
  },
  analyzeButtonDisabled: {
    backgroundColor: "#424242",
  },
  continuousButton: {
    backgroundColor: "#4CAF50",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    borderRadius: 16,
    gap: 12,
  },
  stopButton: {
    backgroundColor: "#F44336",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    borderRadius: 16,
    gap: 12,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  resultContainer: {
    backgroundColor: "#1a1a1a",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  resultTitle: {
    fontSize: 14,
    color: "#B0B0B0",
    marginBottom: 8,
  },
  resultMessage: {
    fontSize: 16,
    color: "#fff",
    lineHeight: 24,
  },
  segmentOverlay: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: "#1E1E1EEE",
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: "#2196F3",
  },
  segmentTypeIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  walkIndicator: {
    backgroundColor: "#FF9800",
  },
  transportIndicator: {
    backgroundColor: "#2196F3",
  },
  segmentTypeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  segmentInstructionText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 12,
  },
  segmentProgressBar: {
    height: 6,
    backgroundColor: "#333",
    borderRadius: 3,
    marginBottom: 8,
    overflow: "hidden",
  },
  segmentProgressFill: {
    height: "100%",
    backgroundColor: "#4CAF50",
    borderRadius: 3,
  },
  segmentDistanceText: {
    fontSize: 12,
    color: "#B0B0B0",
  },
  compassRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
    backgroundColor: "#2A2A2A",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  compassDirectionText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#4CAF50",
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 20,
  },
  message: {
    fontSize: 18,
    color: "#fff",
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  debugImageOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    zIndex: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  debugImage: {
    width: "95%",
    height: "95%",
  },
  closeDebugButton: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "#F44336",
    borderRadius: 20,
    padding: 8,
  },
  bboxOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
  pathCorridorOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 6,
    elevation: 6,
    pointerEvents: "none",
  },
  pathCorridorLabelWrap: {
    position: "absolute",
    top: "20%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  pathCorridorLabel: {
    color: "#00E676",
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    borderColor: "rgba(0, 230, 118, 0.8)",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    letterSpacing: 0.5,
  },
  pathCorridorFill: {
    position: "absolute",
    left: "30%",
    right: "30%",
    bottom: "12%",
    top: "24%",
    backgroundColor: "rgba(0, 230, 118, 0.14)",
    borderWidth: 1.5,
    borderColor: "rgba(0, 230, 118, 0.45)",
    borderRadius: 10,
  },
  pathCorridorLeft: {
    position: "absolute",
    left: "28%",
    bottom: "12%",
    top: "24%",
    width: 3,
    backgroundColor: "rgba(0, 230, 118, 0.9)",
  },
  pathCorridorRight: {
    position: "absolute",
    right: "28%",
    bottom: "12%",
    top: "24%",
    width: 3,
    backgroundColor: "rgba(0, 230, 118, 0.9)",
  },
  pathCorridorCenterLine: {
    position: "absolute",
    left: "50%",
    marginLeft: -1,
    bottom: "12%",
    top: "24%",
    width: 2,
    backgroundColor: "rgba(0, 230, 118, 0.55)",
  },
  bboxRect: {
    position: "absolute",
    borderWidth: 2,
    borderStyle: "solid",
  },
  bboxLabel: {
    position: "absolute",
    top: -18,
    left: 0,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  bboxLabelText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
  },
  debugToggleRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 8,
  },
  debugToggleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#333",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#555",
  },
  debugToggleActive: {
    backgroundColor: "#FF9800",
    borderColor: "#FF9800",
  },
  debugToggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  obstacleList: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#333",
    paddingTop: 8,
  },
  obstacleItem: {
    fontSize: 12,
    color: "#FFD54F",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 2,
  },
  debugInfoPanel: {
    maxHeight: 250,
    backgroundColor: "#0D0D0D",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#FF9800",
  },
  debugInfoTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FF9800",
    marginBottom: 8,
  },
  debugInfoSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFA726",
    marginTop: 8,
    marginBottom: 4,
  },
  debugInfoText: {
    fontSize: 11,
    color: "#B0B0B0",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 3,
  },
  debugInfoDetection: {
    fontSize: 10,
    color: "#81C784",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 2,
  },
});
