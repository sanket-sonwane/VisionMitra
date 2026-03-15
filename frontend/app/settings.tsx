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
import { translate } from "@/localization/translate";
import { speechLanguageConfig } from "@/localization/speechConfig";
import type { MessageKey, SupportedLanguage } from "@/localization/messages";

const LANGUAGE_OPTIONS: Array<{ code: SupportedLanguage; label: string; nativeLabel: string }> = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "gu", label: "Gujarati", nativeLabel: "ગુજરાતી" },
];

const LANGUAGE_SWITCH_CONFIRMATION: Record<SupportedLanguage, string> = {
  en: "Language changed to English.",
  hi: "भाषा हिंदी में बदल दी गई है।",
  gu: "ભાષા ગુજરાતી માં બદલી દેવામાં આવી છે.",
};

export default function Settings() {
  const router = useRouter();
  const { isOnlineMode, toggleMode, userId, language, setLanguage } = useStore();
  const [speechRate, setSpeechRate] = useState(0.9);
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const selectedLanguageCode = speechLanguageConfig[language];

  const speakKey = (messageKey: MessageKey, rate: number = 0.9) => {
    Speech.speak(translate(messageKey), {
      language: selectedLanguageCode,
      pitch: 1.0,
      rate,
    });
  };

  useEffect(() => {
    speakKey("SETTINGS_INTRO");
  }, []);

  const handleModeToggle = () => {
    toggleMode();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const modeKey: MessageKey = !isOnlineMode ? "MODE_SWITCHED_ONLINE" : "MODE_SWITCHED_OFFLINE";
    speakKey(modeKey);
  };

  const testVoice = () => {
    speakKey("VOICE_TEST_SAMPLE", speechRate);
  };

  const speakDescription = (text: string) => {
    Speech.speak(text, { language: selectedLanguageCode, pitch: 1.0, rate: 0.9 });
  };

  const handleLanguageSelect = (nextLanguage: SupportedLanguage) => {
    if (nextLanguage === language) return;

    setLanguage(nextLanguage);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Speech.stop();
    Speech.speak(LANGUAGE_SWITCH_CONFIRMATION[nextLanguage], {
      language: speechLanguageConfig[nextLanguage],
      pitch: 1.0,
      rate: 0.95,
    });
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
              <Ionicons name="language" size={24} color="#9C27B0" />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingName}>Language</Text>
              <Text style={styles.settingDescription}>Choose speech language</Text>
            </View>
          </View>

          <View style={styles.languageOptionsWrap}>
            {LANGUAGE_OPTIONS.map((option) => {
              const isSelected = language === option.code;
              return (
                <TouchableOpacity
                  key={option.code}
                  style={[styles.languageOption, isSelected && styles.languageOptionSelected]}
                  onPress={() => handleLanguageSelect(option.code)}
                >
                  <Text style={[styles.languageOptionTitle, isSelected && styles.languageOptionTitleSelected]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.languageOptionSubtitle, isSelected && styles.languageOptionTitleSelected]}>
                    {option.nativeLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.settingCard}
            onPress={() => {
              setHapticEnabled(!hapticEnabled);
              if (!hapticEnabled) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              speakKey(hapticEnabled ? "HAPTIC_DISABLED" : "HAPTIC_ENABLED");
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
            onPress={() => speakKey("HOW_TO_USE_GUIDE", 0.88)}
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
  languageOptionsWrap: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  languageOption: {
    flex: 1,
    backgroundColor: "#1E1E1E",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  languageOptionSelected: {
    borderColor: "#2196F3",
    backgroundColor: "#102236",
  },
  languageOptionTitle: {
    fontSize: 14,
    color: "#fff",
    fontWeight: "600",
  },
  languageOptionSubtitle: {
    fontSize: 12,
    color: "#B0B0B0",
    marginTop: 2,
  },
  languageOptionTitleSelected: {
    color: "#90CAF9",
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
