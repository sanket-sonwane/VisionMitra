import { StyleSheet, View, TouchableOpacity, Text, Alert, Platform, ScrollView, Image } from "react-native";
import { CameraView, useCameraPermissions, CameraType } from "expo-camera";
import { useState, useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import axios from "axios";
import { useStore } from "@/store";
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
import { decodeBase64ToPixels, getJpegDimensions } from "@/utils/imageUtils";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const SEGMENT_COMPLETION_THRESHOLD = 50; // meters - consider segment complete when within this distance

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
  const locationInterval = useRef<any>(null);
  const headingSubscription = useRef<any>(null);
  const lastDirectionAnnounce = useRef<number>(0);
  const [showDebugImage, setShowDebugImage] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [modelStatus, setModelStatus] = useState<string>("loading");
  const { userId, isOnlineMode, currentSession, setCurrentSession } = useStore();

  useEffect(() => {
    requestLocationPermission();
    initializeNavigation();
    // Preload the on-device YOLO model so first detection is fast
    initDetectionService().then(({ modelLoaded, error }) => {
      setModelStatus(modelLoaded ? "ready" : "scene-only");
      if (!modelLoaded) console.warn("[CAMERA] ONNX model not loaded, using scene analysis:", error);
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
      Speech.stop();
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
      Speech.speak("Segmented navigation active. Starting first segment.");
      updateCurrentSegment();
      startLocationTracking();
      startHeadingTracking();
    } else {
      Speech.speak("Camera mode. Tap analyze button to detect obstacles.");
    }
  };

  const updateCurrentSegment = () => {
    if (!currentSession?.journey_plan) return;

    const segmentIndex = currentSession.current_segment_index || 0;
    const segments = currentSession.journey_plan.segments;

    if (segmentIndex < segments.length) {
      const segment = segments[segmentIndex];
      setCurrentSegment(segment);
      Speech.speak(generateAudioInstruction(segment));
    } else {
      // Journey completed
      Speech.speak("You have arrived at your destination!");
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
      Speech.speak(dirText);
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
      // Move to next segment
      try {
        await axios.patch(
          `${BACKEND_URL}/api/navigation-sessions/${currentSession.id}`,
          null,
          {
            params: { current_segment_index: nextSegmentIndex },
            timeout: 3000,
          }
        );
      } catch (error) {
        console.warn("Backend segment update failed (non-fatal):", error);
      }

      // Always update local session regardless of backend
      const updatedSession = {
        ...currentSession,
        current_segment_index: nextSegmentIndex,
      };
      setCurrentSession(updatedSession);

      Speech.speak(`Segment complete. Starting next segment.`);
      setSegmentProgress(0);
    } else {
      // All segments complete
      await completeNavigation();
    }
  };

  const completeNavigation = async () => {
    if (!currentSession) return;

    try {
      await axios.patch(
        `${BACKEND_URL}/api/navigation-sessions/${currentSession.id}`,
        null,
        {
          params: { status: "completed" },
          timeout: 3000,
        }
      );
    } catch (error) {
      console.warn("Backend navigation complete failed (non-fatal):", error);
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Speech.speak("Navigation complete. You have arrived at your destination.");
    
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

    try {
      setIsAnalyzing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Only announce on manual single-shot analysis, not continuous
      if (!isContinuousRef.current) {
        Speech.speak("Analyzing surroundings...");
      }

      // Capture photo at low quality for fast processing
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.2,
        base64: true,
        skipProcessing: true,
      });

      if (!photo.base64) {
        throw new Error("Failed to capture image");
      }

      let result: any = null;

      // Strategy: Try on-device first. If ONNX unavailable, use server for YOLO.
      // Scene analysis always runs locally.
      if (modelStatus === "ready") {
        // ====== FULL ON-DEVICE DETECTION (ONNX available) ======
        const decoded = await decodeBase64ToPixels(photo.base64);
        if (decoded) {
          const sessionId = currentSession?.id || "default";
          const localResult = await detectObstaclesLocal(
            decoded.pixels, decoded.width, decoded.height, sessionId
          );
          result = {
            obstacles: localResult.obstacles,
            safe_direction: localResult.safeDirection,
            warning_level: localResult.riskLevel,
            audio_message: localResult.audioMessage,
            detection_coords: localResult.detectionCoords,
            debug_info: showDebugInfo ? {
              mode: "on-device",
              model_loaded: localResult.modelLoaded,
              timings: localResult.timings,
              raw_detections_count: localResult.rawDetections.length,
              tracked_objects_count: localResult.trackedObjects.length,
              obstacles_count: localResult.obstacles.length,
              frame_index: localResult.frameIndex,
            } : null,
          };
        }
      } else {
        // ====== HYBRID: Server YOLO + Local Scene Analysis ======
        // Send frame to backend for YOLO detection
        try {
          const serverResponse = await axios.post(
            `${BACKEND_URL}/api/detect-obstacles`,
            {
              image_base64: photo.base64,
              user_id: userId || "anonymous",
              session_id: currentSession?.id || "default",
            },
            { timeout: 5000 }
          );
          result = serverResponse.data;
          if (showDebugInfo) {
            result.debug_info = { ...result.debug_info, mode: "server" };
          }
        } catch (serverErr: any) {
          // Server unreachable — fall back to local scene analysis only
          console.warn("[CAMERA] Server unreachable, using scene-only:", serverErr.message);
          const decoded = await decodeBase64ToPixels(photo.base64);
          if (decoded) {
            const sessionId = currentSession?.id || "default";
            const localResult = await detectObstaclesLocal(
              decoded.pixels, decoded.width, decoded.height, sessionId
            );
            result = {
              obstacles: localResult.obstacles,
              safe_direction: localResult.safeDirection,
              warning_level: localResult.riskLevel,
              audio_message: localResult.audioMessage,
              detection_coords: localResult.detectionCoords,
              debug_info: showDebugInfo ? {
                mode: "scene-only",
                model_loaded: localResult.modelLoaded,
                timings: localResult.timings,
                raw_detections_count: localResult.rawDetections.length,
                tracked_objects_count: localResult.trackedObjects.length,
                obstacles_count: localResult.obstacles.length,
                frame_index: localResult.frameIndex,
              } : null,
            };
          }
        }
      }

      if (result) {
        setLastAnalysis(result);

        if (showDebugInfo) {
          console.log('[DETECT] Mode:', result.debug_info?.mode);
          console.log('[DETECT] Obstacles:', JSON.stringify(result.obstacles));
          console.log('[DETECT] Risk:', result.warning_level);
        }

        // Haptic feedback based on warning level
        if (result.warning_level === "critical" || result.warning_level === "danger") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } else if (result.warning_level === "caution") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }

        // Speak the audio message
        if (result.audio_message) {
          Speech.speak(result.audio_message, {
            language: "en",
            pitch: 1.0,
            rate: 0.9,
          });
        }
      } else {
        Speech.speak("Unable to analyze image. Proceed with caution.");
        setLastAnalysis({
          warning_level: "caution",
          audio_message: "Unable to analyze image. Proceed with caution.",
        });
      }

    } catch (error: any) {
      console.error("Analysis error:", error);
      Speech.speak("Analysis failed. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startContinuousAnalysis = () => {
    setIsActive(true);
    isContinuousRef.current = true;
    Speech.speak("Continuous monitoring started");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Use sequential analysis: fire next as soon as current completes
    const runLoop = async () => {
      while (isContinuousRef.current) {
        await captureAndAnalyze();
        // Small gap between analyses to prevent overload
        await new Promise(r => setTimeout(r, 300));
      }
    };
    runLoop();
  };

  const stopContinuousAnalysis = () => {
    setIsActive(false);
    isContinuousRef.current = false;
    Speech.speak("Continuous monitoring stopped");
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
            Speech.stop();
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Live Navigation</Text>
        <View style={styles.modeIndicator}>
          <View style={[styles.modeDot, { backgroundColor: modelStatus === "ready" ? "#4CAF50" : modelStatus === "scene-only" ? "#2196F3" : "#FF9800" }]} />
          <Text style={styles.modeText}>
            {modelStatus === "ready" ? "AI On-Device" : modelStatus === "scene-only" ? "Server + Scene" : "Loading..."}
          </Text>
        </View>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          ref={cameraRef}
          facing="back"
        />

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
              onLongPress={() => Speech.speak("Analyze once. Takes a photo and analyzes obstacles.")}
            >
              <Ionicons name="scan" size={32} color="#fff" />
              <Text style={styles.buttonText}>
                {isAnalyzing ? "Analyzing..." : "Analyze Now"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.continuousButton}
              onPress={startContinuousAnalysis}
              onLongPress={() => Speech.speak("Start continuous monitoring. Analyzes every 3 seconds.")}
            >
              <Ionicons name="play" size={32} color="#fff" />
              <Text style={styles.buttonText}>Start Monitoring</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopContinuousAnalysis}
            onLongPress={() => Speech.speak("Stop continuous monitoring")}
          >
            <Ionicons name="stop" size={32} color="#fff" />
            <Text style={styles.buttonText}>Stop Monitoring</Text>
          </TouchableOpacity>
        )}
      </View>

      {lastAnalysis && (
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>Last Analysis:</Text>
          <Text style={styles.resultMessage}>{lastAnalysis.audio_message}</Text>
          {lastAnalysis.obstacles && lastAnalysis.obstacles.length > 0 && (
            <View style={styles.obstacleList}>
              {lastAnalysis.obstacles.map((obs: any, idx: number) => (
                <Text key={idx} style={styles.obstacleItem}>
                  {obs.type} • {obs.distance} • {obs.direction} • conf:{obs.confidence} • {obs.moving}
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
