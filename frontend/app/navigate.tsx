import { StyleSheet, View, TouchableOpacity, Text, TextInput, ScrollView, Alert } from "react-native";
import { useState, useEffect, useRef, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { requireOptionalNativeModule } from "expo-modules-core";
import axios from "axios";
import { useStore } from "@/store";
import { getSpeechLanguageCode } from "@/localization/speechConfig";
import {
  speakLocalizedMessage,
  speakLocalizedText,
  stopLocalizedSpeech,
} from "@/localization/speech";
import {
  destinationFoundText,
  destinationSetText,
  directJourneyPlanText,
  navigationStartedText,
  segmentedJourneyPlanText,
} from "@/localization/speechTemplates";
import {
  planJourney,
  calculateDistance,
  formatDistance,
  formatTime,
  generateAudioInstruction,
  consumePendingRouteDestination,
  clearStopCache,
  type JourneyPlan,
  type NavigationSegment,
  type Coordinates,
} from "@/utils/journeyPlanner";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type SpeechRecognitionModuleLike = {
  isRecognitionAvailable: () => boolean;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: Record<string, any>) => void;
  stop: () => void;
  abort: () => void;
  addListener?: (eventName: string, listener: (event: any) => void) => { remove: () => void };
};

function loadSpeechRecognitionModule(): SpeechRecognitionModuleLike | null {
  try {
    return (
      requireOptionalNativeModule<SpeechRecognitionModuleLike>("ExpoSpeechRecognition") || null
    );
  } catch {
    return null;
  }
}

export default function Navigate() {
  const router = useRouter();
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null);
  const [nearbyStops, setNearbyStops] = useState<any[]>([]);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planningJourney, setPlanningJourney] = useState(false);
  const [journeyPlan, setJourneyPlan] = useState<JourneyPlan | null>(null);
  const [showJourneyDetails, setShowJourneyDetails] = useState(false);
  const [isListeningDestination, setIsListeningDestination] = useState(false);
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(true);
  const [voiceModuleMissing, setVoiceModuleMissing] = useState(false);
  const speechRecognitionModuleRef = useRef<SpeechRecognitionModuleLike | null>(null);
  const { userId, isOnlineMode, currentSession, setCurrentSession, language } = useStore();

  useEffect(() => {
    speakLocalizedMessage("NAVIGATION_INTRO");
    // Clear cache on mount
    clearStopCache();

    const pendingDestination = consumePendingRouteDestination();
    if (pendingDestination) {
      setDestinationQuery(pendingDestination);
      void (async () => {
        const resolvedLocation = await getCurrentLocation();
        if (!resolvedLocation) return;
        await geocodeDestination(pendingDestination, resolvedLocation);
      })();
    } else {
      getCurrentLocation();
    }

    const speechRecognitionModule = loadSpeechRecognitionModule();
    speechRecognitionModuleRef.current = speechRecognitionModule;

    if (!speechRecognitionModule) {
      setVoiceInputAvailable(false);
      setVoiceModuleMissing(true);
      return;
    }
    

    setVoiceInputAvailable(speechRecognitionModule.isRecognitionAvailable());

    const startSub = speechRecognitionModule.addListener?.("start", () => {
      setIsListeningDestination(true);
    });

    const endSub = speechRecognitionModule.addListener?.("end", () => {
      setIsListeningDestination(false);
    });

    const resultSub = speechRecognitionModule.addListener?.("result", (event: any) => {
      const transcript = event?.results?.[0]?.transcript?.trim();
      if (!transcript) return;
      setDestinationQuery(transcript);
      if (event?.isFinal) {
        speakLocalizedText(destinationSetText(transcript));
      }
    });

    const errorSub = speechRecognitionModule.addListener?.("error", (event: any) => {
      setIsListeningDestination(false);
      console.warn("Destination voice input error:", event?.error, event?.message);
      speakLocalizedMessage("VOICE_INPUT_FAILED");
    });

    return () => {
      try {
        speechRecognitionModule.abort();
      } catch {
      }

      startSub?.remove();
      endSub?.remove();
      resultSub?.remove();
      errorSub?.remove();
    };
  }, []);

  useEffect(() => {
    if (!voiceModuleMissing) {
      return;
    }
    console.warn(
      "[Navigate] Voice input module not available in current runtime. Use a development build to enable speech recognition."
    );
  }, [voiceModuleMissing]);

  const getCurrentLocation = async (): Promise<Coordinates | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        speakLocalizedMessage("LOCATION_PERMISSION_REQUIRED");
        return null;
      }

      const location = await Location.getCurrentPositionAsync({});
      const coords: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      setCurrentLocation(coords);

      speakLocalizedMessage("LOCATION_ACQUIRED");
      return coords;
    } catch (error) {
      console.error("Location error:", error);
      speakLocalizedMessage("LOCATION_UNAVAILABLE");
      return null;
    }
  };

  // Geocode destination query using Nominatim (OpenStreetMap)
  const geocodeDestination = async (
    queryOverride?: string,
    locationOverride?: Coordinates | null
  ) => {
    const destinationInput = (queryOverride ?? destinationQuery).trim();

    if (!destinationInput) {
      speakLocalizedMessage("ENTER_DESTINATION");
      return;
    }

    setDestinationQuery(destinationInput);

    let effectiveLocation = locationOverride ?? currentLocation;
    if (!effectiveLocation) {
      speakLocalizedMessage("GETTING_LOCATION_FIRST");
      effectiveLocation = await getCurrentLocation();
      if (!effectiveLocation) {
        return;
      }
    }

    setLoading(true);
    setPlanningJourney(true);
    
    try {
      speakLocalizedMessage("SEARCHING_DESTINATION");
      
      // Use Nominatim for geocoding
      const response = await axios.get("https://nominatim.openstreetmap.org/search", {
        params: {
          q: destinationInput,
          format: "json",
          limit: 1,
          addressdetails: 1,
        },
        headers: {
          "User-Agent": "EyeGuide-Navigation-App/1.0",
        },
        timeout: 10000,
      });

      if (!response.data || response.data.length === 0) {
        speakLocalizedMessage("DESTINATION_NOT_FOUND");
        setPlanningJourney(false);
        setLoading(false);
        return;
      }

      const result = response.data[0];
      const destCoords: Coordinates = {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
      };

      setDestinationCoords(destCoords);
      
      const distance = calculateDistance(
        effectiveLocation.latitude,
        effectiveLocation.longitude,
        destCoords.latitude,
        destCoords.longitude
      );

      speakLocalizedText(destinationFoundText(result.display_name, formatDistance(distance)));

      // Plan the journey
      await planAndExecuteJourney(destCoords, result.display_name, effectiveLocation);
      
    } catch (error) {
      console.error("Geocoding error:", error);
      speakLocalizedMessage("DESTINATION_FIND_FAILED");
      setPlanningJourney(false);
      setLoading(false);
    }
  };

  const handleDestinationVoiceInput = async () => {
    if (planningJourney || loading) {
      return;
    }

    const speechRecognitionModule = speechRecognitionModuleRef.current;

    if (!speechRecognitionModule) {
      setVoiceInputAvailable(false);
      Alert.alert(
        "Voice Input Unavailable",
        "Speech recognition requires a development build. Expo Go does not include this native module.",
        [{ text: "OK" }]
      );
      speakLocalizedMessage("VOICE_INPUT_UNAVAILABLE_BUILD");
      return;
    }

    if (isListeningDestination) {
      try {
        speechRecognitionModule.stop();
      } catch {
      }
      return;
    }

    try {
      const permission = await speechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        speakLocalizedMessage("MIC_PERMISSION_REQUIRED");
        return;
      }

      if (!speechRecognitionModule.isRecognitionAvailable()) {
        setVoiceInputAvailable(false);
        speakLocalizedMessage("VOICE_INPUT_UNAVAILABLE_DEVICE");
        return;
      }

      speakLocalizedMessage("LISTENING_FOR_DESTINATION");
      speechRecognitionModule.start({
        lang: getSpeechLanguageCode(language),
        interimResults: true,
        maxAlternatives: 1,
        contextualStrings: ["Pune", "PMPML", "Station", "Bus stop", "Metro"],
      });
    } catch (error) {
      console.error("Destination voice input start error:", error);
      speakLocalizedMessage("VOICE_INPUT_START_FAILED");
    }
  };

  // Plan journey using journey planner
  const planAndExecuteJourney = async (
    destination: Coordinates,
    destinationName: string,
    startCoordinates?: Coordinates
  ) => {
    const originCoordinates = startCoordinates ?? currentLocation;

    if (!originCoordinates) {
      speakLocalizedMessage("CURRENT_LOCATION_NOT_AVAILABLE");
      setPlanningJourney(false);
      setLoading(false);
      return;
    }

    try {
      setPlanningJourney(true);
      speakLocalizedMessage("COMPUTING_ROUTE");

      const plan = await planJourney(originCoordinates, destination);
      setJourneyPlan(plan);
      setShowJourneyDetails(true);

      // Announce journey plan
      if (plan.journey_type === "DIRECT_WALK") {
        speakLocalizedText(
          directJourneyPlanText(
            formatDistance(plan.total_distance),
            formatTime(plan.estimated_time)
          )
        );
      } else {
        speakLocalizedText(
          segmentedJourneyPlanText(
            plan.segments.length,
            plan.selected_origin_stop?.name || "-",
            plan.selected_destination_stop?.name || "-",
            formatDistance(plan.total_distance),
            formatTime(plan.estimated_time)
          )
        );
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
    } catch (error) {
      console.error("Journey planning error:", error);
      speakLocalizedMessage("JOURNEY_PLAN_FAILED");
      setJourneyPlan(null);
    } finally {
      setPlanningJourney(false);
      setLoading(false);
    }
  };

  // Start navigation with journey plan
  const startNavigationWithPlan = async () => {
    if (!journeyPlan || !currentLocation || !destinationCoords) {
      speakLocalizedMessage("JOURNEY_PLAN_NOT_AVAILABLE");
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsNavigating(true);

      let sessionData: any = null;

      // Try creating session on backend, but fall back to local if it fails
      try {
        const response = await axios.post(`${BACKEND_URL}/api/navigation-sessions`, {
          user_id: userId || "demo_user",
          start_location: currentLocation,
          destination: destinationCoords,
          destination_name: destinationQuery,
          mode: isOnlineMode ? "online" : "offline",
          journey_plan: journeyPlan,
          current_segment_index: 0,
        }, { timeout: 5000 });
        sessionData = response.data;
      } catch (backendError) {
        console.warn("Backend session creation failed, using local session:", backendError);
        // Create a local session so navigation works without backend
        sessionData = {
          id: `local_${Date.now()}`,
          user_id: userId || "demo_user",
          start_location: currentLocation,
          destination: destinationCoords,
          destination_name: destinationQuery,
          mode: isOnlineMode ? "online" : "offline",
          journey_plan: journeyPlan,
          current_segment_index: 0,
          status: "active",
          started_at: new Date().toISOString(),
        };
      }

      setCurrentSession(sessionData);
      speakLocalizedText(navigationStartedText(generateAudioInstruction(journeyPlan.segments[0])));
      
      // Open camera for live navigation
      router.push("/camera");
    } catch (error) {
      console.error("Navigation error:", error);
      speakLocalizedMessage("NAVIGATION_START_FAILED");
    } finally {
      setIsNavigating(false);
    }
  };

  const processPendingDestinationCommand = async () => {
    if (planningJourney || loading) {
      return;
    }

    const pendingDestination = consumePendingRouteDestination();
    if (!pendingDestination) {
      return;
    }

    setDestinationQuery(pendingDestination);
    const resolvedLocation = currentLocation ?? (await getCurrentLocation());
    if (!resolvedLocation) {
      return;
    }

    await geocodeDestination(pendingDestination, resolvedLocation);
  };

  useFocusEffect(
    useCallback(() => {
      void processPendingDestinationCommand();
      return () => {};
    }, [currentLocation, planningJourney, loading])
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            stopLocalizedSpeech();
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Navigation</Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={getCurrentLocation}
        >
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Current Location Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Location</Text>
          {currentLocation ? (
            <View style={styles.locationCard}>
              <Ionicons name="location" size={24} color="#4CAF50" />
              <View style={styles.locationText}>
                <Text style={styles.locationLabel}>Latitude: {currentLocation.latitude.toFixed(6)}</Text>
                <Text style={styles.locationLabel}>Longitude: {currentLocation.longitude.toFixed(6)}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.placeholderText}>Getting location...</Text>
          )}
        </View>

        {/* Destination Input Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Where do you want to go?</Text>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#808080" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Enter destination address or place"
              placeholderTextColor="#666"
              value={destinationQuery}
              onChangeText={setDestinationQuery}
              editable={!planningJourney}
            />
            <TouchableOpacity
              style={[
                styles.voiceInputButton,
                isListeningDestination && styles.voiceInputButtonActive,
                (!voiceInputAvailable || planningJourney) && styles.voiceInputButtonDisabled,
              ]}
              onPress={handleDestinationVoiceInput}
              disabled={!voiceInputAvailable || planningJourney}
              onLongPress={() =>
                speakLocalizedMessage(
                  isListeningDestination
                    ? "TAP_TO_STOP_LISTENING"
                    : "TAP_TO_SPEAK_DESTINATION"
                )
              }
            >
              <Ionicons
                name={isListeningDestination ? "stop-circle" : "mic"}
                size={20}
                color="#fff"
              />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.planButton, (planningJourney || !currentLocation || !destinationQuery.trim()) && styles.planButtonDisabled]}
            onPress={() => {
              void geocodeDestination();
            }}
            disabled={planningJourney || !currentLocation || !destinationQuery.trim()}
          >
            <Ionicons name="navigate" size={24} color="#fff" />
            <Text style={styles.planButtonText}>
              {planningJourney ? "Planning Route..." : "Plan Journey"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Journey Details Section */}
        {journeyPlan && showJourneyDetails && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Journey Plan</Text>
            
            <View style={styles.journeyCard}>
              <View style={styles.journeySummary}>
                <View style={styles.journeyInfo}>
                  <Text style={styles.journeyLabel}>Total Distance</Text>
                  <Text style={styles.journeyValue}>{formatDistance(journeyPlan.total_distance)}</Text>
                </View>
                <View style={styles.journeyInfo}>
                  <Text style={styles.journeyLabel}>Est. Time</Text>
                  <Text style={styles.journeyValue}>{formatTime(journeyPlan.estimated_time)}</Text>
                </View>
                <View style={styles.journeyInfo}>
                  <Text style={styles.journeyLabel}>Segments</Text>
                  <Text style={styles.journeyValue}>{journeyPlan.segments.length}</Text>
                </View>
              </View>
            </View>

            {/* Segment Cards */}
            {journeyPlan.segments.map((segment, index) => (
              <View key={index} style={styles.segmentCard}>
                <View style={styles.segmentHeader}>
                  <View style={[
                    styles.segmentIcon,
                    segment.type === "WALK" ? styles.walkIcon : styles.transportIcon
                  ]}>
                    <Ionicons
                      name={segment.type === "WALK" ? "walk" : segment.transport_type === "Bus" ? "bus" : "train"}
                      size={20}
                      color="#fff"
                    />
                  </View>
                  <View style={styles.segmentInfo}>
                    <Text style={styles.segmentType}>
                      {segment.type === "WALK" ? "Walk" : `Take ${segment.transport_type}`}
                    </Text>
                    <Text style={styles.segmentInstruction}>{segment.instruction}</Text>
                  </View>
                </View>
                <View style={styles.segmentDetails}>
                  <Text style={styles.segmentDistance}>{formatDistance(segment.distance)}</Text>
                  <Text style={styles.segmentSeparator}>•</Text>
                  <Text style={styles.segmentTime}>~{formatTime(estimateTravelTime(segment.distance, segment.type))} min</Text>
                </View>
              </View>
            ))}

            {/* Start Navigation Button */}
            <TouchableOpacity
              style={[styles.startNavButton, isNavigating && styles.startNavButtonDisabled]}
              onPress={startNavigationWithPlan}
              disabled={isNavigating}
            >
              <Ionicons name="play-circle" size={28} color="#fff" />
              <Text style={styles.startNavButtonText}>
                {isNavigating ? "Starting..." : "Start Navigation"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {currentSession && (
        <View style={styles.activeNavBanner}>
          <Ionicons name="navigate" size={20} color="#fff" />
          <Text style={styles.activeNavText}>Navigation Active</Text>
          <TouchableOpacity
            onPress={() => router.push("/camera")}
            style={styles.viewButton}
          >
            <Text style={styles.viewButtonText}>View</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// Helper function inline for time estimation
function estimateTravelTime(distance: number, type: "WALK" | "TRANSPORT"): number {
  const speed = type === "WALK" ? 1.4 : 8.3; // m/s
  return Math.round(distance / speed / 60); // minutes
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
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
  refreshButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 16,
  },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E1E1E",
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  locationText: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 14,
    color: "#B0B0B0",
    marginBottom: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E1E1E",
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#fff",
    paddingVertical: 16,
  },
  voiceInputButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2196F3",
  },
  voiceInputButtonActive: {
    backgroundColor: "#F44336",
  },
  voiceInputButtonDisabled: {
    backgroundColor: "#404040",
  },
  planButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2196F3",
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  planButtonDisabled: {
    backgroundColor: "#404040",
  },
  planButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  journeyCard: {
    backgroundColor: "#1E1E1E",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  journeySummary: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  journeyInfo: {
    alignItems: "center",
  },
  journeyLabel: {
    fontSize: 12,
    color: "#B0B0B0",
    marginBottom: 4,
  },
  journeyValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2196F3",
  },
  segmentCard: {
    backgroundColor: "#1E1E1E",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  segmentHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  segmentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  walkIcon: {
    backgroundColor: "#FF9800",
  },
  transportIcon: {
    backgroundColor: "#2196F3",
  },
  segmentInfo: {
    flex: 1,
  },
  segmentType: {
    fontSize: 14,
    fontWeight: "600",
    color: "#B0B0B0",
    marginBottom: 4,
  },
  segmentInstruction: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  segmentDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  segmentDistance: {
    fontSize: 14,
    color: "#2196F3",
    fontWeight: "600",
  },
  segmentSeparator: {
    fontSize: 14,
    color: "#666",
  },
  segmentTime: {
    fontSize: 14,
    color: "#B0B0B0",
  },
  startNavButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4CAF50",
    padding: 18,
    borderRadius: 12,
    gap: 12,
    marginTop: 8,
  },
  startNavButtonDisabled: {
    backgroundColor: "#404040",
  },
  startNavButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  placeholderText: {
    fontSize: 14,
    color: "#808080",
    textAlign: "center",
    paddingVertical: 32,
  },
  activeNavBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#4CAF50",
    padding: 16,
    gap: 12,
  },
  activeNavText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  viewButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  viewButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4CAF50",
  },
});
