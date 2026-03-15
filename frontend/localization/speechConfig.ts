import type { AppLanguage } from "@/store";

export const speechLanguageCodeMap: Record<AppLanguage, string> = {
  en: "en-US",
  hi: "hi-IN",
  gu: "gu-IN",
};

export const getSpeechLanguageCode = (language: AppLanguage): string =>
  speechLanguageCodeMap[language] ?? speechLanguageCodeMap.en;
