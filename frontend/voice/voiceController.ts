import { requireOptionalNativeModule } from "expo-modules-core";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { speakLocalizedMessage, speakLocalizedText } from "@/localization/speech";
import { sosStatusSummaryText } from "@/localization/speechTemplates";
import { getSpeechLanguageCode } from "@/localization/speechConfig";
import { useStore, type AppLanguage } from "@/store";
import { triggerEmergencyFlow, type SmsMode } from "@/utils/sosService";
import { startRoute } from "@/utils/journeyPlanner";
import {
  containsWakePhrase,
  parseIntent,
  stripWakePhrase,
  type ParsedIntent,
} from "./intentParser";

export type VoiceSystemState = "PASSIVE" | "ACTIVE_LISTENING";

type SpeechRecognitionModuleLike = {
  isRecognitionAvailable: () => boolean;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
  addListener?: (eventName: string, listener: (event: any) => void) => { remove: () => void };
};

export interface VoiceControllerOptions {
  navigateToRoutePlanner: () => void;
  navigateToEmergency: () => void;
  navigateToHome: () => void;
}

const ACTIVE_LISTENING_TIMEOUT_MS = 10_000;
const RECOGNITION_RESET_DELAY_MS = 120;
const PASSIVE_CONTINUOUS_RESTART_DELAY_MS = 400; // fast restart if continuous session dies
const PASSIVE_REFRESH_MS = 25_000;               // refresh session before Android kills it
const ACTIVE_RESTART_DELAY_MS = 500;
const ACTIVE_NO_SPEECH_DELAY_MS = 900;
const WAKE_RESPONSE_GAP_MS = 1200;
const TTS_RETRY_DELAY_MS = 800;
const PASSIVE_WAKE_LANGUAGE = "en-IN";
const DUPLICATE_INTENT_WINDOW_MS = 2_500;

const localizedText = (text: Record<AppLanguage, string>): string => {
  const language = useStore.getState().language;
  return text[language] ?? text.en;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function loadSpeechRecognitionModule(): SpeechRecognitionModuleLike | null {
  try {
    return (
      requireOptionalNativeModule<SpeechRecognitionModuleLike>("ExpoSpeechRecognition") ||
      null
    );
  } catch {
    return null;
  }
}

function extractTranscript(event: any): string {
  const results = event?.results;

  if (Array.isArray(results)) {
    for (const result of results) {
      if (typeof result === "string") return result;
      if (result && typeof result.transcript === "string") return result.transcript;

      if (Array.isArray(result) && result.length > 0) {
        if (typeof result[0] === "string") return result[0];
        if (result[0] && typeof result[0].transcript === "string") {
          return result[0].transcript;
        }
      }
    }
  }

  if (typeof event?.transcript === "string") {
    return event.transcript;
  }

  return "";
}

/** Returns all recognition alternatives (for noise-tolerant wake-word matching). */
function extractAllTranscripts(event: any): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (t: string): void => {
    const s = t.trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  };

  const rawResults = event?.results;
  if (Array.isArray(rawResults)) {
    for (const result of rawResults) {
      if (typeof result === "string") {
        push(result);
      } else if (result && typeof result.transcript === "string") {
        push(result.transcript);
      } else if (Array.isArray(result)) {
        for (const alt of result) {
          if (typeof alt === "string") push(alt);
          else if (alt && typeof alt.transcript === "string") push(alt.transcript);
        }
      }
    }
  }

  if (typeof event?.transcript === "string") push(event.transcript);
  return out;
}

const getRecognitionErrorCode = (event: any): string =>
  typeof event?.error === "string" ? event.error.toLowerCase() : "unknown";

const isIgnorableRecognitionError = (errorCode: string): boolean =>
  errorCode === "aborted" || errorCode === "no-speech";

export class VoiceController {
  private readonly options: VoiceControllerOptions;
  private speechModule: SpeechRecognitionModuleLike | null = null;
  private state: VoiceSystemState = "PASSIVE";
  private running = false;
  private handlingIntent = false;
  private skipNextEndRestart = false;
  private activeTimeout: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private passiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Array<{ remove: () => void }> = [];
  private lastIntentSignature = "";
  private lastIntentTimestamp = 0;

  constructor(options: VoiceControllerOptions) {
    this.options = options;
  }

  public getState(): VoiceSystemState {
    return this.state;
  }

  public async start(): Promise<boolean> {
    if (this.running) return true;

    const module = loadSpeechRecognitionModule();
    if (!module) {
      console.warn("[VoiceController] ExpoSpeechRecognition module unavailable in this build.");
      return false;
    }

    if (!module.isRecognitionAvailable()) {
      console.warn("[VoiceController] Speech recognition is unavailable on this device.");
      return false;
    }

    const permission = await module.requestPermissionsAsync();
    if (!permission.granted) {
      console.warn("[VoiceController] Microphone permission denied.");
      speakLocalizedMessage("MIC_PERMISSION_REQUIRED");
      return false;
    }

    this.speechModule = module;
    this.running = true;
    this.attachListeners();
    await this.transitionToPassive(0);
    return true;
  }

  public stop(): void {
    this.running = false;
    this.clearTimers();
    this.detachListeners();
    this.skipNextEndRestart = true;

    try {
      this.speechModule?.abort();
    } catch {
      try {
        this.speechModule?.stop();
      } catch {
      }
    }

    this.speechModule = null;
    this.state = "PASSIVE";
  }

  private attachListeners(): void {
    if (!this.speechModule?.addListener) return;

    const endSub = this.speechModule.addListener("end", this.handleRecognitionEnd);
    const errorSub = this.speechModule.addListener("error", this.handleRecognitionError);
    const resultSub = this.speechModule.addListener("result", this.handleRecognitionResult);

    this.subscriptions = [endSub, errorSub, resultSub].filter(Boolean);
  }

  private detachListeners(): void {
    for (const sub of this.subscriptions) {
      try {
        sub.remove();
      } catch {
      }
    }
    this.subscriptions = [];
  }

  private clearTimers(): void {
    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    this.clearPassiveRefresh();
  }

  /** Schedules a proactive refresh of the continuous passive session (prevents OS kill). */
  private schedulePassiveRefresh(): void {
    this.clearPassiveRefresh();
    this.passiveRefreshTimer = setTimeout(() => {
      if (!this.running || this.state !== "PASSIVE") return;
      this.skipNextEndRestart = true;
      try { this.speechModule?.abort(); } catch { try { this.speechModule?.stop(); } catch {} }
      setTimeout(() => {
        if (this.running && this.state === "PASSIVE") {
          void this.beginRecognitionForCurrentState();
        }
      }, RECOGNITION_RESET_DELAY_MS);
    }, PASSIVE_REFRESH_MS);
  }

  private clearPassiveRefresh(): void {
    if (this.passiveRefreshTimer) {
      clearTimeout(this.passiveRefreshTimer);
      this.passiveRefreshTimer = null;
    }
  }

  private async stopRecognitionForTransition(): Promise<void> {
    if (!this.speechModule) return;

    this.skipNextEndRestart = true;

    try {
      this.speechModule.abort();
    } catch {
      try {
        this.speechModule.stop();
      } catch {
      }
    }

    await sleep(RECOGNITION_RESET_DELAY_MS);
  }

  private scheduleRestart(delayMs: number): void {
    if (!this.running || !this.speechModule) return;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    this.restartTimer = setTimeout(() => {
      void this.beginRecognitionForCurrentState();
    }, delayMs);
  }

  private async beginRecognitionForCurrentState(): Promise<void> {
    if (!this.running || !this.speechModule) return;

    try {
      const speaking = await Speech.isSpeakingAsync();
      if (speaking) {
        this.scheduleRestart(TTS_RETRY_DELAY_MS);
        return;
      }
    } catch {
      // If speech state is unavailable, proceed with recognition start.
    }

    const selectedLanguage = useStore.getState().language;
    const recognitionLanguage =
      this.state === "PASSIVE"
        ? PASSIVE_WAKE_LANGUAGE
        : selectedLanguage === "en"
        ? PASSIVE_WAKE_LANGUAGE
        : getSpeechLanguageCode(selectedLanguage);

    const isPassive = this.state === "PASSIVE";

    try {
      this.speechModule.start({
        lang: recognitionLanguage,
        interimResults: false,
        // Passive mode: continuous = mic stays open, no ON/OFF cycling sounds
        // Active mode: single utterance burst
        continuous: isPassive,
        // More alternatives in passive = noise-tolerant wake-word detection
        maxAlternatives: isPassive ? 3 : 1,
        contextualStrings: [
          "vision mitra",
          "hey vision mitra",
          "navigate to",
          "take me to",
          "stop navigation",
          "mujhe le chalo",
          "mane lai jao",
          "sos",
          "current location",
        ],
      });
    } catch (error) {
      console.warn("[VoiceController] Failed to start recognition:", error);
      this.scheduleRestart(PASSIVE_CONTINUOUS_RESTART_DELAY_MS);
      return;
    }

    if (isPassive) {
      this.schedulePassiveRefresh();
    }
  }

  private startActiveTimeout(): void {
    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }

    this.activeTimeout = setTimeout(() => {
      if (!this.running || this.state !== "ACTIVE_LISTENING") return;

      speakLocalizedText(
        localizedText({
          en: "I did not hear a command. Returning to standby.",
          hi: "मुझे कोई कमांड नहीं मिली। मैं स्टैंडबाय मोड में लौट रही हूँ।",
          gu: "મને કોઈ કમાન્ડ સંભળાઈ નથી. હું સ્ટેન્ડબાય મોડમાં પાછી જઈ રહી છું.",
        })
      );

      void this.transitionToPassive(PASSIVE_CONTINUOUS_RESTART_DELAY_MS);
    }, ACTIVE_LISTENING_TIMEOUT_MS);
  }

  private async transitionToPassive(delayMs: number): Promise<void> {
    this.clearPassiveRefresh();
    this.state = "PASSIVE";

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }

    await this.stopRecognitionForTransition();
    this.scheduleRestart(delayMs);
  }

  private async transitionToActiveListening(): Promise<void> {
    this.clearPassiveRefresh();
    this.state = "ACTIVE_LISTENING";
    await this.stopRecognitionForTransition();

    speakLocalizedText(
      localizedText({
        en: "Hello, how can I help you?",
        hi: "नमस्ते, मैं आपकी कैसे मदद कर सकती हूँ?",
        gu: "નમસ્તે, હું તમારી કેવી રીતે મદદ કરી શકું?",
      })
    );

    this.startActiveTimeout();
    this.scheduleRestart(WAKE_RESPONSE_GAP_MS);
  }

  private readonly handleRecognitionEnd = (): void => {
    if (!this.running) return;

    if (this.skipNextEndRestart) {
      this.skipNextEndRestart = false;
      return;
    }

    if (this.handlingIntent) return;

    // Passive uses continuous mode — 'end' means session died unexpectedly → restart fast.
    // Active uses single-shot — 'end' is normal after one utterance.
    this.scheduleRestart(
      this.state === "PASSIVE" ? PASSIVE_CONTINUOUS_RESTART_DELAY_MS : ACTIVE_RESTART_DELAY_MS
    );
  };

  private readonly handleRecognitionError = (event: any): void => {
    if (!this.running) return;

    const errorCode = getRecognitionErrorCode(event);
    if (!isIgnorableRecognitionError(errorCode)) {
      console.warn("[VoiceController] Recognition error:", event?.error, event?.message);
    }

    if (this.handlingIntent) return;

    // In passive continuous mode, errors are always followed by an 'end' event which
    // will schedule the restart. Scheduling here would cause a double-restart.
    if (this.state === "PASSIVE") return;

    const restartDelay = errorCode === "no-speech" ? ACTIVE_NO_SPEECH_DELAY_MS : ACTIVE_RESTART_DELAY_MS;
    this.scheduleRestart(restartDelay);
  };

  private readonly handleRecognitionResult = (event: any): void => {
    if (!this.running) return;

    const isFinal = event?.isFinal ?? true;
    if (!isFinal) return;

    if (this.state === "PASSIVE") {
      // Check ALL alternatives for wake phrase — noise-tolerant: any matching guess triggers.
      const transcripts = extractAllTranscripts(event);
      const wakeTranscript = transcripts.find((t) => containsWakePhrase(t));
      if (!wakeTranscript) return; // silently ignore — mic stays open (continuous mode)

      // Wake phrase detected. Try to extract an inline command from the same utterance.
      const cleanedTranscript = stripWakePhrase(wakeTranscript);
      const inlineIntent = parseIntent(cleanedTranscript);
      if (inlineIntent) {
        void this.executeIntent(inlineIntent);
        return;
      }

      // Wake word only — switch to active listening for command
      void this.transitionToActiveListening();
      return;
    }

    if (this.state !== "ACTIVE_LISTENING") return;

    const transcript = extractTranscript(event).trim();
    if (!transcript) return;

    const cleanedTranscript = stripWakePhrase(transcript);
    const parsedIntent = parseIntent(cleanedTranscript || transcript);
    if (!parsedIntent) return;

    void this.executeIntent(parsedIntent);
  };

  private async executeIntent(parsedIntent: ParsedIntent): Promise<void> {
    if (this.handlingIntent) return;

    const intentSignature = `${parsedIntent.intent}:${(parsedIntent.destination || "")
      .toLowerCase()
      .trim()}`;
    const now = Date.now();
    if (
      this.lastIntentSignature === intentSignature &&
      now - this.lastIntentTimestamp < DUPLICATE_INTENT_WINDOW_MS
    ) {
      return;
    }

    this.lastIntentSignature = intentSignature;
    this.lastIntentTimestamp = now;

    this.handlingIntent = true;

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }

    await this.stopRecognitionForTransition();

    try {
      switch (parsedIntent.intent) {
        case "navigation": {
          if (!parsedIntent.destination) {
            speakLocalizedText(
              localizedText({
                en: "Please tell me your destination.",
                hi: "कृपया अपना गंतव्य बताइए।",
                gu: "કૃપા કરીને તમારું ગંતવ્ય કહો.",
              })
            );
            break;
          }

          startRoute(parsedIntent.destination);
          speakLocalizedText(
            localizedText({
              en: `Starting navigation to ${parsedIntent.destination}.`,
              hi: `${parsedIntent.destination} के लिए नेविगेशन शुरू कर रही हूँ।`,
              gu: `${parsedIntent.destination} માટે નેવિગેશન શરૂ કરી રહી છું.`,
            })
          );
          this.options.navigateToRoutePlanner();
          break;
        }

        case "stop_navigation": {
          useStore.getState().setCurrentSession(null);
          speakLocalizedText(
            localizedText({
              en: "Navigation stopped.",
              hi: "नेविगेशन रोक दिया गया है।",
              gu: "નેવિગેશન બંધ કરવામાં આવ્યું છે.",
            })
          );
          this.options.navigateToHome();
          break;
        }

        case "current_location": {
          await this.handleCurrentLocationIntent();
          break;
        }

        case "sos": {
          await this.handleSosIntent();
          break;
        }
      }
    } catch (error) {
      console.error("[VoiceController] Intent execution failed:", error);
    } finally {
      this.handlingIntent = false;
      await this.transitionToPassive(PASSIVE_CONTINUOUS_RESTART_DELAY_MS);
    }
  }

  private async handleCurrentLocationIntent(): Promise<void> {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== "granted") {
      speakLocalizedMessage("LOCATION_PERMISSION_REQUIRED");
      return;
    }

    try {
      const currentPosition = await Location.getCurrentPositionAsync({});
      const latitude = currentPosition.coords.latitude.toFixed(5);
      const longitude = currentPosition.coords.longitude.toFixed(5);

      speakLocalizedText(
        localizedText({
          en: `Your current location is latitude ${latitude}, longitude ${longitude}.`,
          hi: `आपकी वर्तमान लोकेशन अक्षांश ${latitude}, देशांतर ${longitude} है।`,
          gu: `તમારું વર્તમાન સ્થાન અક્ષાંશ ${latitude}, રેખાંશ ${longitude} છે.`,
        })
      );
    } catch {
      speakLocalizedMessage("LOCATION_UNAVAILABLE");
    }
  }

  private async handleSosIntent(): Promise<void> {
    const contacts = useStore.getState().emergencyContacts;

    if (contacts.length === 0) {
      speakLocalizedMessage("ADD_CONTACTS_FIRST");
      this.options.navigateToEmergency();
      return;
    }

    speakLocalizedMessage("SOS_ACTIVATED");

    const smsMode: SmsMode =
      process.env.EXPO_PUBLIC_SOS_SMS_MODE === "direct" ? "direct" : "composer";

    const result = await triggerEmergencyFlow({
      contacts,
      modePreference: smsMode,
    });

    speakLocalizedText(
      sosStatusSummaryText(result.location.locationAvailable, result.notify.modeUsed)
    );

    if (result.notify.notifyErrors.length > 0) {
      console.warn("SOS notify issues:", result.notify.notifyErrors);
    }

    this.options.navigateToEmergency();
  }
}
