import { StyleSheet, View, TouchableOpacity, Text, Switch, ScrollView } from "react-native";
import { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useRouter } from "expo-router";
import { useStore } from "@/store";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { getSpeechLanguageCode } from "@/localization/speechConfig";

export default function Settings() {
  const router = useRouter();
  const {
    isOnlineMode,
    toggleMode,
    userId,
    language,
    setLanguage,
    voiceCommandsEnabled,
    setVoiceCommandsEnabled,
  } = useStore();
  const speechRate = 0.9;
  const [hapticEnabled, setHapticEnabled] = useState(true);

  useEffect(() => {
    Speech.speak("Settings. Configure your preferences.");
  }, []);

  const handleModeToggle = () => {
    toggleMode();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newMode = !isOnlineMode ? "online" : "offline";
    Speech.speak(`Switched to ${newMode} mode.`);
  };

  const handleVoiceCommandsToggle = () => {
    const nextValue = !voiceCommandsEnabled;
    setVoiceCommandsEnabled(nextValue);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Speech.speak(nextValue ? "Voice commands enabled." : "Voice commands disabled.");
  };

  const testVoice = () => {
    Speech.speak("This is a voice test. Adjust speech rate in settings.", {
      language: getSpeechLanguageCode(language),
      pitch: 1.0,
      rate: speechRate,
    });
  };

  const updateLanguage = (nextLanguage: "en" | "hi" | "gu") => {
    setLanguage(nextLanguage);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const languageFeedback =
      nextLanguage === "hi"
        ? "भाषा हिंदी में बदल दी गई है।"
        : nextLanguage === "gu"
        ? "ભાષા ગુજરાતી પર સેટ કરવામાં આવી છે."
        : "Language set to English.";
    Speech.speak(languageFeedback, {
      language: getSpeechLanguageCode(nextLanguage),
      pitch: 1.0,
      rate: 0.95,
    });
  };

  const speakDescription = (text: string) => {
    Speech.speak(text, { language: "en", pitch: 1.0, rate: 0.9 });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            Speech.stop();
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
            onLongPress={() =>
              speakDescription(
                "Toggle between online and offline mode. Online mode uses AI for accurate detection. Offline mode uses basic detection and works without internet."
              )
            }
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
          <Text style={styles.sectionTitle}>Accessibility</Text>

          <View style={styles.settingCard}>
            <View style={styles.settingIcon}>
              <Ionicons name="language" size={24} color="#4CAF50" />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingName}>Language</Text>
              <Text style={styles.settingDescription}>English / हिन्दी / ગુજરાતી</Text>
            </View>
          </View>

          <View style={styles.languageRow}>
            <TouchableOpacity
              style={[styles.languagePill, language === "en" && styles.languagePillActive]}
              onPress={() => updateLanguage("en")}
            >
              <Text style={[styles.languagePillText, language === "en" && styles.languagePillTextActive]}>EN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.languagePill, language === "hi" && styles.languagePillActive]}
              onPress={() => updateLanguage("hi")}
            >
              <Text style={[styles.languagePillText, language === "hi" && styles.languagePillTextActive]}>हिं</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.languagePill, language === "gu" && styles.languagePillActive]}
              onPress={() => updateLanguage("gu")}
            >
              <Text style={[styles.languagePillText, language === "gu" && styles.languagePillTextActive]}>ગુ</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.settingCard}
            onPress={handleVoiceCommandsToggle}
            onLongPress={() =>
              speakDescription(
                "Toggle voice commands. When enabled, wake phrase based voice control stays active."
              )
            }
          >
            <View style={styles.settingIcon}>
              <Ionicons name="mic" size={24} color="#9C27B0" />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingName}>Voice Commands</Text>
              <Text style={styles.settingDescription}>Wake phrase voice control</Text>
            </View>
            <Switch
              value={voiceCommandsEnabled}
              onValueChange={handleVoiceCommandsToggle}
              trackColor={{ false: "#767577", true: "#9C27B0" }}
              thumbColor={voiceCommandsEnabled ? "#fff" : "#f4f3f4"}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingCard}
            onPress={() => {
              setHapticEnabled(!hapticEnabled);
              if (!hapticEnabled) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              Speech.speak(
                hapticEnabled ? "Haptic feedback disabled" : "Haptic feedback enabled"
              );
            }}
            onLongPress={() =>
              speakDescription(
                "Toggle haptic feedback. Provides vibration alerts for actions and warnings."
              )
            }
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
            onLongPress={() =>
              speakDescription("Test voice output. Press to hear a sample message.")
            }
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
            onPress={() =>
              Speech.speak(
                "Eye Guide is an AI-powered navigation assistant for visually impaired users. It provides real-time obstacle detection, voice guidance, emergency SOS, and helps find nearby transport stops. Use online mode for accurate AI detection or offline mode for basic navigation."
              )
            }
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
  languageRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  languagePill: {
    flex: 1,
    backgroundColor: "#2A2A2A",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3A3A3A",
  },
  languagePillActive: {
    backgroundColor: "#4CAF50",
    borderColor: "#4CAF50",
  },
  languagePillText: {
    color: "#E0E0E0",
    fontSize: 16,
    fontWeight: "700",
  },
  languagePillTextActive: {
    color: "#ffffff",
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
