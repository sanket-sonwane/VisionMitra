import * as Speech from "expo-speech";
import { useStore, type AppLanguage } from "@/store";
import { type MessageKey } from "./messages";
import { getSpeechLanguageCode } from "./speechConfig";
import { translate } from "./translate";

type LocalizedSpeakOptions = {
  rate?: number;
  pitch?: number;
  language?: AppLanguage;
};

let cachedVoiceLanguages: Set<string> | null = null;
let voicesLoadPromise: Promise<Set<string> | null> | null = null;

const normalizeLanguageCode = (languageCode: string): string =>
  languageCode.trim().toLowerCase();

const isLanguageMatch = (voiceLanguage: string, preferredLanguage: string): boolean => {
  if (voiceLanguage === preferredLanguage) return true;

  const preferredBase = preferredLanguage.split("-")[0];
  if (voiceLanguage === preferredBase) return true;
  if (voiceLanguage.startsWith(`${preferredBase}-`)) return true;

  return false;
};

const loadVoiceLanguages = async (): Promise<Set<string> | null> => {
  if (cachedVoiceLanguages) return cachedVoiceLanguages;
  if (voicesLoadPromise) return voicesLoadPromise;

  voicesLoadPromise = (async () => {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const voiceLanguages = new Set<string>();

      for (const voice of voices) {
        if (typeof voice.language === "string" && voice.language.length > 0) {
          voiceLanguages.add(normalizeLanguageCode(voice.language));
        }
      }

      cachedVoiceLanguages = voiceLanguages;
      return voiceLanguages;
    } catch (error) {
      console.warn("[SPEECH] Unable to fetch available voices:", error);
      return null;
    }
  })();

  return voicesLoadPromise;
};

const resolveSpeechLanguageCode = async (preferredCode: string): Promise<string | undefined> => {
  const normalizedPreferred = normalizeLanguageCode(preferredCode);
  const availableVoiceLanguages = await loadVoiceLanguages();

  // If the platform doesn't expose voice metadata, still try the preferred language code.
  if (!availableVoiceLanguages || availableVoiceLanguages.size === 0) {
    return preferredCode;
  }

  if (availableVoiceLanguages.has(normalizedPreferred)) {
    return preferredCode;
  }

  const fallbackMatch = Array.from(availableVoiceLanguages).find((voiceLanguage) =>
    isLanguageMatch(voiceLanguage, normalizedPreferred)
  );

  // If no compatible voice exists, omit language so device default voice still speaks.
  return fallbackMatch;
};

const speakInternal = async (
  text: string,
  options: LocalizedSpeakOptions = {}
): Promise<void> => {
  const activeLanguage = options.language ?? useStore.getState().language;
  const preferredLanguageCode = getSpeechLanguageCode(activeLanguage);
  const resolvedLanguageCode = await resolveSpeechLanguageCode(preferredLanguageCode);

  const speakOptions: Speech.SpeechOptions = {
    pitch: options.pitch ?? 1.0,
    rate: options.rate ?? 1.0,
  };

  if (resolvedLanguageCode) {
    speakOptions.language = resolvedLanguageCode;
  }

  Speech.speak(text, speakOptions);
};

export const speakLocalizedText = (
  text: string,
  options: LocalizedSpeakOptions = {}
): void => {
  void speakInternal(text, options);
};

export const speakLocalizedMessage = (
  messageKey: MessageKey,
  options: LocalizedSpeakOptions = {}
): void => {
  speakLocalizedText(translate(messageKey), options);
};

export const stopLocalizedSpeech = (): void => {
  Speech.stop();
};
