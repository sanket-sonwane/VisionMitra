export type VoiceIntentType =
  | "navigation"
  | "stop_navigation"
  | "sos"
  | "current_location";

export interface ParsedIntent {
  intent: VoiceIntentType;
  rawText: string;
  destination?: string;
}

const WAKE_PHRASE_PATTERNS: RegExp[] = [
  /\bhey\s+vision\s*mitra\b/i,
  /\bhey\s+visionmitra\b/i,
  /\bhi\s+vision\s*mitra\b/i,
  /\bvision\s*mitra\b/i,
];

const WAKE_PREFIX_PATTERNS: RegExp[] = [
  /^\s*(?:hey|hi)\s+vision\s*mitra[\s,]*/i,
  /^\s*(?:hey|hi)\s+visionmitra[\s,]*/i,
  /^\s*vision\s*mitra[\s,]*/i,
];

const STOP_NAVIGATION_PATTERNS: RegExp[] = [
  /\bstop\s+navigation\b/i,
  /\bcancel\s+navigation\b/i,
  /\bend\s+navigation\b/i,
  /\bnavigation\s+band\s+karo\b/i,
  /\brasta\s+band\s+karo\b/i,
  /नेविगेशन\s*बंद\s*करो/u,
  /रास्ता\s*बंद\s*करो/u,
  /रूट\s*बंद\s*करो/u,
  /નેવિગેશન\s*બંધ\s*કરો/u,
  /માર્ગદર્શન\s*બંધ\s*કરો/u,
  /રૂટ\s*બંધ\s*કરો/u,
];

const SOS_PATTERNS: RegExp[] = [
  /\bsos\b/i,
  /\bemergency\b/i,
  /\bhelp\s+me\b/i,
  /\bneed\s+help\b/i,
  /\bmadad\b/i,
  /\bbachao\b/i,
  /आपातकाल/u,
  /मदद/u,
  /बचाओ/u,
  /ઇમર્જન્સી/u,
  /મદદ/u,
  /બચાવો/u,
];

const CURRENT_LOCATION_PATTERNS: RegExp[] = [
  /\bcurrent\s+location\b/i,
  /\bmy\s+location\b/i,
  /\bwhere\s+am\s+i\b/i,
  /\bwhere\s+are\s+we\b/i,
  /\blocation\s+bolo\b/i,
  /\blocation\s+batao\b/i,
  /मैं\s+कहाँ\s+हूँ/u,
  /मेरी\s+लोकेशन/u,
  /मेरी\s+जगह/u,
  /હું\s+ક્યાં\s+છું/u,
  /મારું\s+સ્થાન/u,
  /મારી\s+લોકેશન/u,
];

const NAVIGATION_PATTERNS: RegExp[] = [
  /(?:take me to|navigate to|go to)\s+(.+)/i,
  /(?:route to|start navigation to)\s+(.+)/i,
  /mujhe\s+(.+?)\s+le\s+chalo/i,
  /mujhe\s+(.+?)\s+jana\s+hai/i,
  /mane\s+(.+?)\s+lai\s+ja(?:o)?/i,
  /mane\s+(.+?)\s+javu\s+che/i,
  /मुझे\s+(.+?)\s+ले\s*चलो/u,
  /मुझे\s+(.+?)\s+ले\s+जाओ/u,
  /(.+?)\s+ले\s*चलो/u,
  /મને\s+(.+?)\s+લઈ\s+જા(?:ઓ)?/u,
  /(.+?)\s+લઈ\s+જા(?:ઓ)?/u,
];

const normalizeSpokenText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeDestination = (destination: string): string =>
  destination
    .replace(/^(?:to|towards|please|pls)\s+/i, "")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const extractByPatterns = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;

    const destination = sanitizeDestination(match[1] || "");
    if (!destination) continue;
    return destination;
  }

  return null;
};

export const containsWakePhrase = (recognizedText: string): boolean => {
  const text = normalizeSpokenText(recognizedText);
  return WAKE_PHRASE_PATTERNS.some((pattern) => pattern.test(text));
};

export const stripWakePhrase = (recognizedText: string): string => {
  let text = recognizedText.trim();

  for (const pattern of WAKE_PREFIX_PATTERNS) {
    text = text.replace(pattern, "").trim();
  }

  return text;
};

export const parseIntent = (recognizedText: string): ParsedIntent | null => {
  const rawText = stripWakePhrase(recognizedText.trim());
  if (!rawText) return null;

  const normalizedText = normalizeSpokenText(rawText);

  if (matchesAny(normalizedText, STOP_NAVIGATION_PATTERNS) || matchesAny(rawText, STOP_NAVIGATION_PATTERNS)) {
    return {
      intent: "stop_navigation",
      rawText,
    };
  }

  if (matchesAny(normalizedText, SOS_PATTERNS) || matchesAny(rawText, SOS_PATTERNS)) {
    return {
      intent: "sos",
      rawText,
    };
  }

  if (matchesAny(normalizedText, CURRENT_LOCATION_PATTERNS) || matchesAny(rawText, CURRENT_LOCATION_PATTERNS)) {
    return {
      intent: "current_location",
      rawText,
    };
  }

  const destination =
    extractByPatterns(rawText, NAVIGATION_PATTERNS) ||
    extractByPatterns(normalizedText, NAVIGATION_PATTERNS);

  if (destination) {
    return {
      intent: "navigation",
      rawText,
      destination,
    };
  }

  return null;
};
