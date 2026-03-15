import { StyleSheet, View, TouchableOpacity, Text, Switch, ScrollView } from "react-native";
import { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useStore, type AppLanguage } from "@/store";
import type { MessageKey } from "@/localization/messages";
import { speakLocalizedMessage, stopLocalizedSpeech } from "@/localization/speech";
import * as Device from "expo-device";
import Constants from "expo-constants";

export default function Settings() {
  const router = useRouter();
  const { isOnlineMode, toggleMode, userId, language, setLanguage } = useStore();
  const [speechRate, setSpeechRate] = useState(0.9);
  const [hapticEnabled, setHapticEnabled] = useState(true);

  const languageOptions: Array<{
    value: AppLanguage;
    label: string;
    nativeLabel: string;
    confirmationKey: MessageKey;
  }> = [
    { value: "en", label: "English", nativeLabel: "English", confirmationKey: "LANGUAGE_SET_ENGLISH" },
    { value: "hi", label: "Hindi", nativeLabel: "हिंदी", confirmationKey: "LANGUAGE_SET_HINDI" },
    { value: "gu", label: "Gujarati", nativeLabel: "ગુજરાતી", confirmationKey: "LANGUAGE_SET_GUJARATI" },
  ];

  const speakMessageKey = (messageKey: MessageKey, rate: number = 0.9) => {
    speakLocalizedMessage(messageKey, { rate });
  };

  useEffect(() => {
    speakMessageKey("SETTINGS_INTRO");
  }, []);

  const handleModeToggle = () => {
    const nextOnlineMode = !isOnlineMode;
    toggleMode();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    speakMessageKey(nextOnlineMode ? "MODE_SWITCHED_ONLINE" : "MODE_SWITCHED_OFFLINE");
  };

  const handleLanguageSelect = (nextLanguage: AppLanguage, confirmationKey: MessageKey) => {
    if (nextLanguage === language) return;
    setLanguage(nextLanguage);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stopLocalizedSpeech();
    speakLocalizedMessage(confirmationKey, { rate: speechRate });
  };

  const testVoice = () => {
    speakMessageKey("VOICE_TEST_SAMPLE", speechRate);
  };

  const speakDescription = (messageKey: MessageKey) => {
    speakMessageKey(messageKey, 0.9);
  };

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
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Navigation Mode</Text>
          <TouchableOpacity
            style={styles.settingCard}
            onPress={handleModeToggle}
            onLongPress={() => speakDescription("SETTINGS_MODE_TOGGLE_DESC")}
          >
            <View style={styles.settingIcon}>
              <Ionicons
                name={isOnlineMode ? "cloud" : "cloud-offline"}
                size={24}
                color={isOnlineMode ? "#4CAF50" : "#FF9800"}
              />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingName}>
                {isOnlineMode ? "Online Mode" : "Offline Mode"}
              </Text>
              <Text style={styles.settingDescription}>
                {isOnlineMode
                  ? "AI-powered obstacle detection active"
                  : "Basic detection without internet"}
              </Text>
            </View>
            <Switch
              value={isOnlineMode}
              onValueChange={handleModeToggle}
              trackColor={{ false: "#767577", true: "#4CAF50" }}
              thumbColor={isOnlineMode ? "#fff" : "#f4f3f4"}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Language</Text>
          {languageOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={styles.settingCard}
              onPress={() => handleLanguageSelect(option.value, option.confirmationKey)}
            >
              <View style={styles.settingIcon}>
                <Ionicons name="language" size={24} color="#26C6DA" />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingName}>{option.label}</Text>
                <Text style={styles.settingDescription}>{option.nativeLabel}</Text>
              </View>
              {language === option.value ? (
                <Ionicons name="checkmark-circle" size={24} color="#26C6DA" />
              ) : (
                <Ionicons name="ellipse-outline" size={24} color="#767577" />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Accessibility</Text>

          <TouchableOpacity
            style={styles.settingCard}
            onPress={() => {
              setHapticEnabled(!hapticEnabled);
              if (!hapticEnabled) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              speakMessageKey(
                hapticEnabled ? "HAPTIC_FEEDBACK_DISABLED" : "HAPTIC_FEEDBACK_ENABLED"
              );
            }}
            onLongPress={() => speakDescription("SETTINGS_HAPTIC_DESC")}
          >
            <View style={styles.settingIcon}>
              <Ionicons name="hand-left" size={24} color="#2196F3" />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingName}>Haptic Feedback</Text>
              <Text style={styles.settingDescription}>
                Vibration alerts for actions
              </Text>
            </View>
            <Switch
              value={hapticEnabled}
              onValueChange={(value) => {
                setHapticEnabled(value);
                if (value) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
              trackColor={{ false: "#767577", true: "#2196F3" }}
              thumbColor={hapticEnabled ? "#fff" : "#f4f3f4"}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingCard}
            onPress={testVoice}
            onLongPress={() => speakDescription("SETTINGS_VOICE_TEST_DESC")}
          >
            <View style={styles.settingIcon}>
              <Ionicons name="volume-high" size={24} color="#FF9800" />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingName}>Voice Feedback</Text>
              <Text style={styles.settingDescription}>Test audio output</Text>
            </View>
            <Ionicons name="play-circle" size={32} color="#FF9800" />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>App Version</Text>
              <Text style={styles.infoValue}>
                {Constants.expoConfig?.version || "1.0.0"}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Device</Text>
              <Text style={styles.infoValue}>{Device.modelName || "Unknown"}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>User ID</Text>
              <Text style={styles.infoValue}>{userId || "demo_user"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Features</Text>
          <View style={styles.featureCard}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.featureText}>Real-time obstacle detection</Text>
          </View>
          <View style={styles.featureCard}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.featureText}>Voice-guided navigation</Text>
          </View>
          <View style={styles.featureCard}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.featureText}>Emergency SOS system</Text>
          </View>
          <View style={styles.featureCard}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.featureText}>Nearby transport finder</Text>
          </View>
          <View style={styles.featureCard}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.featureText}>Offline mode support</Text>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.helpButton}
            onPress={() => speakMessageKey("SETTINGS_HELP_DESCRIPTION")}
          >
            <Ionicons name="help-circle" size={24} color="#2196F3" />
            <Text style={styles.helpText}>How to use Eye Guide</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
  settingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E1E1E",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  settingIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2A2A2A",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: "#B0B0B0",
  },
  infoCard: {
    backgroundColor: "#1E1E1E",
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 14,
    color: "#B0B0B0",
  },
  infoValue: {
    fontSize: 14,
    color: "#fff",
    fontWeight: "500",
  },
  featureCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E1E1E",
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  featureText: {
    fontSize: 14,
    color: "#fff",
  },
  helpButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E1E1E",
    padding: 20,
    borderRadius: 12,
    gap: 12,
  },
  helpText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2196F3",
  },
});
