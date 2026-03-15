import { StyleSheet, View, TouchableOpacity, Text, Image, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { speakLocalizedMessage } from "@/localization/speech";
import type { MessageKey } from "@/localization/messages";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    // Welcome message on load
    speakLocalizedMessage("HOME_WELCOME", { rate: 1.0 });
  }, []);

  const handlePress = (route: string, labelKey: MessageKey) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    speakLocalizedMessage(labelKey);
    router.push(route as any);
  };

  const speak = (messageKey: MessageKey) => {
    speakLocalizedMessage(messageKey, { rate: 0.95 });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="eye" size={64} color="#2196F3" />
        <Text style={styles.title}>VisionMitra</Text>
        <Text style={styles.subtitle}>AI Navigation for Visually Impaired</Text>
      </View>

      <View style={styles.menuContainer}>
        <TouchableOpacity
          style={[styles.menuButton, styles.primaryButton]}
          onPress={() => handlePress("/camera", "HOME_LIVE_NAV_LABEL")}
          onLongPress={() => speak("HOME_LIVE_NAV_DESC")}
        >
          <Ionicons name="camera" size={48} color="#fff" />
          <Text style={styles.menuButtonText}>Live Navigation</Text>
          <Text style={styles.menuButtonSubtext}>Camera Detection</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuButton, styles.secondaryButton]}
          onPress={() => handlePress("/navigate", "HOME_NAVIGATE_LABEL")}
          onLongPress={() => speak("HOME_NAVIGATE_DESC")}
        >
          <Ionicons name="navigate" size={48} color="#fff" />
          <Text style={styles.menuButtonText}>Navigate</Text>
          <Text style={styles.menuButtonSubtext}>Find Routes</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuButton, styles.emergencyButton]}
          onPress={() => handlePress("/emergency", "HOME_EMERGENCY_LABEL")}
          onLongPress={() => speak("HOME_EMERGENCY_DESC")}
        >
          <Ionicons name="alert-circle" size={48} color="#fff" />
          <Text style={styles.menuButtonText}>Emergency</Text>
          <Text style={styles.menuButtonSubtext}>SOS Contacts</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuButton, styles.settingsButton]}
          onPress={() => handlePress("/settings", "HOME_SETTINGS_LABEL")}
          onLongPress={() => speak("HOME_SETTINGS_DESC")}
        >
          <Ionicons name="settings" size={48} color="#fff" />
          <Text style={styles.menuButtonText}>Settings</Text>
          <Text style={styles.menuButtonSubtext}>Preferences</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Tap once to select</Text>
        <Text style={styles.footerText}>Long press for description</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  header: {
    alignItems: "center",
    paddingTop: 40,
    paddingBottom: 20,
  },
  title: {
    fontSize: 42,
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 16,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    color: "#B0B0B0",
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  menuContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 16,
  },
  menuButton: {
    height: 120,
    borderRadius: 16,
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  primaryButton: {
    backgroundColor: "#2196F3",
  },
  secondaryButton: {
    backgroundColor: "#4CAF50",
  },
  emergencyButton: {
    backgroundColor: "#F44336",
  },
  settingsButton: {
    backgroundColor: "#FF9800",
  },
  menuButtonText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF",
    marginTop: 8,
  },
  menuButtonSubtext: {
    fontSize: 14,
    color: "#E0E0E0",
    marginTop: 4,
  },
  footer: {
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  footerText: {
    fontSize: 14,
    color: "#808080",
  },
});
