import { StyleSheet, View, TouchableOpacity, Text, Alert, Platform } from "react-native";
import { CameraView, useCameraPermissions, CameraType } from "expo-camera";
import { useState, useEffect, useRef, useCallback } from "react";
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
  formatDistance,
  generateAudioInstruction,
  type NavigationSegment,
  type Coordinates,
} from "@/utils/journeyPlanner";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const SEGMENT_COMPLETION_THRESHOLD = 50; // meters
const MIN_CAPTURE_INTERVAL_MS = 300; // fastest we'll capture (prevents CPU overload)

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
  const [fps, setFps] = useState<number>(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);
  const streamingRef = useRef<boolean>(false); // controls streaming loop
  const lastWarningRef = useRef<string>(""); // dedup speech
  const lastAudioMsgRef = useRef<string>(""); // dedup speech content
  const frameCountRef = useRef<number>(0);
  const fpsTimerRef = useRef<any>(null);
  const locationInterval = useRef<any>(null);
  const { userId, isOnlineMode, currentSession, setCurrentSession } = useStore();

  useEffect(() => {
    requestLocationPermission();
    initializeNavigation();
    
    return () => {
      streamingRef.current = false;
      if (fpsTimerRef.current) {
        clearInterval(fpsTimerRef.current);
      }
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
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
      Speech.speak("Segmented navigation active. Starting live detection.");
      updateCurrentSegment();
      startLocationTracking();
      // Auto-start live streaming when navigating
      setTimeout(() => startContinuousAnalysis(), 1500);
    } else {
      Speech.speak("Camera mode. Tap start to begin live detection.");
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
    // Track location every 5 seconds to check segment progress
    locationInterval.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({});
        const coords: Coordinates = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setCurrentLocation(coords);
        checkSegmentCompletion(coords);
      } catch (error) {
        console.error("Location tracking error:", error);
      }
    }, 5000);
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
          }
        );

        // Update local session
        const updatedSession = {
          ...currentSession,
          current_segment_index: nextSegmentIndex,
        };
        setCurrentSession(updatedSession);

        Speech.speak(`Segment complete. Starting next segment.`);
        setSegmentProgress(0);
      } catch (error) {
        console.error("Error updating segment:", error);
      }
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
        }
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Speech.speak("Navigation complete. You have arrived at your destination.");
      
      // Clear session
      setCurrentSession(null);
      setCurrentSegment(null);
      
      // Stop tracking
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
    } catch (error) {
      console.error("Error completing navigation:", error);
    }
  };

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationPermission(status === "granted");
  };

  // Provide haptic + spoken feedback, with dedup to avoid repeating the same message
  const handleDetectionFeedback = useCallback((result: any, forceSpeak: boolean = false) => {
    // Haptic feedback on every frame based on warning level
    if (result.warning_level === "critical" || result.warning_level === "danger") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else if (result.warning_level === "caution") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    // No haptic for "safe" during streaming to avoid buzz fatigue

    // Only speak when warning level changes or message content changes (dedup in live mode)
    const warningChanged = result.warning_level !== lastWarningRef.current;
    const messageChanged = result.audio_message !== lastAudioMsgRef.current;

    if (forceSpeak || warningChanged || messageChanged) {
      lastWarningRef.current = result.warning_level;
      lastAudioMsgRef.current = result.audio_message;

      // Stop any in-progress speech so new one starts immediately
      Speech.stop();
      Speech.speak(result.audio_message, {
        language: "en",
        pitch: 1.0,
        rate: 1.0, // slightly faster for live mode
      });
    }
  }, []);

  // Continuous live-streaming loop: capture -> send -> repeat immediately
  const streamLoop = useCallback(async () => {
    while (streamingRef.current) {
      const frameStart = Date.now();

      try {
        if (!cameraRef.current) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        // Capture frame at low quality for speed
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.2,
          base64: true,
        });

        if (!photo?.base64 || !streamingRef.current) continue;
        console.log(`[Stream] Frame captured: ${photo.width}x${photo.height}, base64 len=${photo.base64.length}`);

        // Get location (cached, non-blocking)
        let location = null;
        if (locationPermission) {
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low, // fast GPS for streaming
            });
            location = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            };
          } catch { /* skip location this frame */ }
        }

        if (!streamingRef.current) break;

        if (isOnlineMode) {
          const response = await axios.post(`${BACKEND_URL}/api/detect-obstacles`, {
            image_base64: photo.base64,
            user_id: userId || "demo_user",
            session_id: currentSession?.id,
            latitude: location?.latitude,
            longitude: location?.longitude,
          }, {
            timeout: 8000
          });

          if (!streamingRef.current) break;

          const result = response.data;
          setLastAnalysis(result);
          setStreamError(null); // clear any previous error
          setIsAnalyzing(false); // show we just got a result
          handleDetectionFeedback(result);
        } else {
          setLastAnalysis({
            warning_level: "caution",
            audio_message: "Offline mode active. Limited obstacle detection."
          });
        }

        frameCountRef.current += 1;

      } catch (error: any) {
        // Show error to user for debugging
        const errMsg = error?.message || String(error);
        console.warn("Stream frame error:", errMsg);
        setStreamError(errMsg);
        // Brief backoff on error to avoid hammering a down server
        await new Promise(r => setTimeout(r, 1000));
      }

      // Enforce minimum capture interval to prevent overheating/CPU overload
      const elapsed = Date.now() - frameStart;
      if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, MIN_CAPTURE_INTERVAL_MS - elapsed));
      }
    }

    setIsAnalyzing(false);
  }, [isOnlineMode, locationPermission, userId, currentSession, handleDetectionFeedback]);

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

  // Single frame capture for manual "Analyze Now" button
  const captureAndAnalyze = async () => {
    if (!cameraRef.current || isAnalyzing) return;

    try {
      setIsAnalyzing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Speech.speak("Analyzing surroundings...");

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.2,
        base64: true,
      });

      if (!photo.base64) {
        throw new Error("Failed to capture image");
      }
      console.log(`[CaptureOnce] Photo captured: ${photo.width}x${photo.height}, base64 len=${photo.base64.length}`);

      let location = null;
      if (locationPermission) {
        const loc = await Location.getCurrentPositionAsync({});
        location = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
      }

      if (isOnlineMode) {
        const response = await axios.post(`${BACKEND_URL}/api/detect-obstacles`, {
          image_base64: photo.base64,
          user_id: userId || "demo_user",
          session_id: currentSession?.id,
          latitude: location?.latitude,
          longitude: location?.longitude,
        }, {
          timeout: 10000
        });

        const result = response.data;
        setLastAnalysis(result);
        handleDetectionFeedback(result, true);
      } else {
        Speech.speak("Offline mode. Using basic detection. Please proceed with caution.");
        setLastAnalysis({
          warning_level: "caution",
          audio_message: "Offline mode active. Limited obstacle detection."
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
    if (streamingRef.current) return; // already running
    streamingRef.current = true;
    setIsActive(true);
    setIsAnalyzing(true);
    setStreamError(null);
    frameCountRef.current = 0;
    Speech.speak("Live detection started");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // FPS counter: update every second
    fpsTimerRef.current = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);

    // Launch the streaming loop (runs async, controlled by streamingRef)
    streamLoop();
  };

  const stopContinuousAnalysis = () => {
    streamingRef.current = false;
    setIsActive(false);
    setIsAnalyzing(false);
    Speech.speak("Live detection stopped");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    if (fpsTimerRef.current) {
      clearInterval(fpsTimerRef.current);
      fpsTimerRef.current = null;
    }
    setFps(0);
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
          <View style={[styles.modeDot, { backgroundColor: isOnlineMode ? "#4CAF50" : "#FF9800" }]} />
          <Text style={styles.modeText}>{isOnlineMode ? "Online" : "Offline"}</Text>
        </View>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          ref={cameraRef}
          facing="back"
        />

        {/* Live streaming indicator */}
        {isActive && (
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
            <Text style={styles.fpsText}>{fps} fps</Text>
          </View>
        )}

        {/* Stream error indicator */}
        {streamError && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning" size={16} color="#fff" />
            <Text style={styles.errorText} numberOfLines={2}>{streamError}</Text>
          </View>
        )}

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
            <View style={styles.segmentProgressBar}>
              <View style={[styles.segmentProgressFill, { width: `${segmentProgress}%` }]} />
            </View>
            <Text style={styles.segmentDistanceText}>
              {formatDistance(currentSegment.distance)} • Segment {(currentSession?.current_segment_index || 0) + 1} of {currentSession?.journey_plan?.segments?.length || 1}
            </Text>
          </View>
        )}

        {lastAnalysis && (
          <View style={[styles.statusOverlay, { backgroundColor: getWarningColor(lastAnalysis.warning_level) + "CC" }]}>
            <Text style={styles.statusText}>{lastAnalysis.warning_level?.toUpperCase()}</Text>

            {/* Scene context info */}
            {lastAnalysis.scene_type && (
              <Text style={styles.sceneText}>
                {lastAnalysis.scene_type?.replace(/_/g, " ").toUpperCase()}
                {lastAnalysis.ground_type && lastAnalysis.ground_type !== "unknown" ? ` • ${lastAnalysis.ground_type}` : ""}
              </Text>
            )}

            {/* Wall warning */}
            {lastAnalysis.wall_ahead && (
              <Text style={styles.wallWarning}>
                ⚠ WALL {lastAnalysis.wall_distance?.toUpperCase() || "AHEAD"}
              </Text>
            )}

            {/* Path status */}
            {lastAnalysis.path_status && lastAnalysis.path_status !== "clear" && (
              <Text style={styles.pathStatus}>
                Path: {lastAnalysis.path_status?.replace(/_/g, " ")}
              </Text>
            )}

            {lastAnalysis.obstacles && lastAnalysis.obstacles.length > 0 ? (
              <Text style={styles.obstacleCount}>
                {lastAnalysis.obstacles.length} Obstacle{lastAnalysis.obstacles.length > 1 ? "s" : ""}
                {lastAnalysis.obstacles.map((o: any) => ` • ${o.type} ${o.distance}`).join("")}
              </Text>
            ) : lastAnalysis.detection_count != null && (
              <Text style={styles.obstacleCount}>
                {lastAnalysis.detection_count} detections
                {lastAnalysis.frame_size ? ` • ${lastAnalysis.frame_size}` : ""}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {!isActive ? (
          <>
            <TouchableOpacity
              style={[styles.analyzeButton, isAnalyzing && styles.analyzeButtonDisabled]}
              onPress={captureAndAnalyze}
              disabled={isAnalyzing}
              onLongPress={() => Speech.speak("Analyze once. Takes a single photo and checks for obstacles.")}
            >
              <Ionicons name="scan" size={32} color="#fff" />
              <Text style={styles.buttonText}>
                {isAnalyzing ? "Analyzing..." : "Analyze Once"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.continuousButton}
              onPress={startContinuousAnalysis}
              onLongPress={() => Speech.speak("Start live detection. Streams camera continuously.")}
            >
              <Ionicons name="videocam" size={32} color="#fff" />
              <Text style={styles.buttonText}>Start Live Detection</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopContinuousAnalysis}
            onLongPress={() => Speech.speak("Stop live detection")}
          >
            <Ionicons name="stop" size={32} color="#fff" />
            <Text style={styles.buttonText}>Stop Live Detection</Text>
          </TouchableOpacity>
        )}
      </View>

      {lastAnalysis && (
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>Navigation Audio:</Text>
          <Text style={styles.resultMessage}>{lastAnalysis.audio_message}</Text>
          {lastAnalysis.scene_description && (
            <Text style={styles.sceneDescription}>{lastAnalysis.scene_description}</Text>
          )}
          {lastAnalysis.navigation_guidance && lastAnalysis.navigation_guidance !== lastAnalysis.audio_message && (
            <Text style={styles.navGuidance}>{lastAnalysis.navigation_guidance}</Text>
          )}
        </View>
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
    top: 50,
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
  liveIndicator: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#F44336",
  },
  liveText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#F44336",
  },
  fpsText: {
    fontSize: 11,
    color: "#aaa",
    marginLeft: 4,
  },
  errorBanner: {
    position: "absolute",
    top: 40,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(244,67,54,0.85)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  errorText: {
    fontSize: 11,
    color: "#fff",
    flex: 1,
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
  sceneDescription: {
    fontSize: 13,
    color: "#81D4FA",
    marginTop: 6,
    fontStyle: "italic",
  },
  navGuidance: {
    fontSize: 13,
    color: "#A5D6A7",
    marginTop: 4,
  },
  sceneText: {
    fontSize: 11,
    color: "#E0E0E0",
    fontWeight: "600",
    marginTop: 2,
    letterSpacing: 0.5,
  },
  wallWarning: {
    fontSize: 13,
    color: "#FFCDD2",
    fontWeight: "700",
    marginTop: 2,
  },
  pathStatus: {
    fontSize: 11,
    color: "#FFE0B2",
    marginTop: 1,
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
});
