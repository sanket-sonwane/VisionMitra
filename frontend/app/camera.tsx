import { StyleSheet, View, TouchableOpacity, Text, Alert, Platform } from "react-native";
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
  const { userId, isOnlineMode, currentSession, setCurrentSession } = useStore();

  useEffect(() => {
    requestLocationPermission();
    initializeNavigation();
    
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

      // Capture photo
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        base64: true,
        skipProcessing: true,
      });

      if (!photo.base64) {
        throw new Error("Failed to capture image");
      }

      // Get location
      let location = null;
      if (locationPermission) {
        const loc = await Location.getCurrentPositionAsync({});
        location = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
      }

      // Send to backend for analysis (only if online mode)
      if (isOnlineMode) {
        const response = await axios.post(`${BACKEND_URL}/api/detect-obstacles`, {
          image_base64: photo.base64,
          user_id: userId || "demo_user",
          session_id: currentSession?.id,
          latitude: location?.latitude,
          longitude: location?.longitude,
        }, {
          timeout: 15000
        });

        const result = response.data;
        setLastAnalysis(result);

        // Haptic feedback based on warning level
        if (result.warning_level === "critical" || result.warning_level === "danger") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } else if (result.warning_level === "caution") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }

        // Speak the audio message
        Speech.speak(result.audio_message, {
          language: "en",
          pitch: 1.0,
          rate: 0.9,
        });
      } else {
        // Offline mode - basic analysis
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
});
