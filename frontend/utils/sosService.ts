import { Linking, NativeModules, Platform } from "react-native";
import * as Location from "expo-location";

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
}

export type SmsMode = "composer" | "direct";
type SmsModeUsed = "composer" | "direct" | "failed";

interface LocationResult {
  latitude: number | null;
  longitude: number | null;
  locationAvailable: boolean;
  locationError?: string;
}

interface NotifyResult {
  modeUsed: SmsModeUsed;
  contactsAttempted: string[];
  contactsNotified: string[];
  notifyErrors: string[];
}

export interface TriggerEmergencyParams {
  contacts: EmergencyContact[];
  modePreference?: SmsMode;
  locationTimeoutMs?: number;
  batteryPercent?: number;
}

export interface TriggerEmergencyResult {
  message: string;
  location: LocationResult;
  notify: NotifyResult;
  topPriorityContact: EmergencyContact | null;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").trim();
}

function getConfiguredMode(modePreference?: SmsMode): SmsMode {
  if (modePreference) return modePreference;
  const envMode = process.env.EXPO_PUBLIC_SOS_SMS_MODE?.toLowerCase();
  return envMode === "direct" ? "direct" : "composer";
}

function sortByPriority(contacts: EmergencyContact[]): EmergencyContact[] {
  return [...contacts].sort((a, b) => (a.priority || 999) - (b.priority || 999));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutError: Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(timeoutError), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export async function getCurrentLocationWithTimeout(timeoutMs: number = 12000): Promise<LocationResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return {
        latitude: null,
        longitude: null,
        locationAvailable: false,
        locationError: "Location permission denied",
      };
    }

    const position = await withTimeout(
      Location.getCurrentPositionAsync({}),
      timeoutMs,
      new Error("Location timeout")
    );

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      locationAvailable: true,
    };
  } catch (error: any) {
    return {
      latitude: null,
      longitude: null,
      locationAvailable: false,
      locationError: error?.message || "Location unavailable",
    };
  }
}

export function buildEmergencyMessage(
  latitude: number | null,
  longitude: number | null,
  timestamp: Date,
  batteryPercent?: number
): string {
  const lines = [
    "🚨 EMERGENCY ALERT",
    "",
    "I may need immediate assistance.",
  ];

  if (latitude != null && longitude != null) {
    lines.push("", `Live location: https://maps.google.com/?q=${latitude},${longitude}`);
  } else {
    lines.push("", "Live location: unavailable");
  }

  lines.push("", `Time: ${timestamp.toLocaleString()}`);
  if (typeof batteryPercent === "number") {
    lines.push(`Battery: ${Math.max(0, Math.min(100, Math.round(batteryPercent)))}%`);
  }

  return lines.join("\n");
}

function buildSmsUrls(recipients: string[], message: string): string[] {
  const separator = Platform.OS === "ios" ? "&" : "?";
  const encodedBody = encodeURIComponent(message);
  const commaRecipients = recipients.join(",");
  const semicolonRecipients = recipients.join(";");

  const candidates = [
    commaRecipients ? `sms:${commaRecipients}${separator}body=${encodedBody}` : "",
    semicolonRecipients ? `sms:${semicolonRecipients}${separator}body=${encodedBody}` : "",
    recipients[0] ? `sms:${recipients[0]}${separator}body=${encodedBody}` : "",
    `sms:${separator}body=${encodedBody}`,
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

async function openComposerSms(phones: string[], message: string): Promise<NotifyResult> {
  const cleaned = phones.map(normalizePhone).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      modeUsed: "failed",
      contactsAttempted: [],
      contactsNotified: [],
      notifyErrors: ["No valid contact numbers"],
    };
  }

  try {
    const candidateUrls = buildSmsUrls(cleaned, message);
    let lastError: unknown;

    for (const url of candidateUrls) {
      try {
        await Linking.openURL(url);
        return {
          modeUsed: "composer",
          contactsAttempted: cleaned,
          contactsNotified: cleaned,
          notifyErrors: [],
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      modeUsed: "failed",
      contactsAttempted: cleaned,
      contactsNotified: [],
      notifyErrors: [
        lastError instanceof Error
          ? `SMS composer is unavailable on this device: ${lastError.message}`
          : "SMS composer is unavailable on this device",
      ],
    };
  } catch (error: any) {
    return {
      modeUsed: "failed",
      contactsAttempted: cleaned,
      contactsNotified: [],
      notifyErrors: [error?.message || "Failed to open SMS composer"],
    };
  }
}

async function sendDirectSms(phones: string[], message: string): Promise<NotifyResult> {
  const cleaned = phones.map(normalizePhone).filter(Boolean);
  if (Platform.OS !== "android") {
    return {
      modeUsed: "failed",
      contactsAttempted: cleaned,
      contactsNotified: [],
      notifyErrors: ["Direct SMS mode is supported only on Android native builds"],
    };
  }

  const directModule =
    NativeModules?.SOSDirectSms || NativeModules?.DirectSms || NativeModules?.SmsManagerModule;

  if (!directModule || typeof directModule.sendSMS !== "function") {
    return {
      modeUsed: "failed",
      contactsAttempted: cleaned,
      contactsNotified: [],
      notifyErrors: ["Direct SMS native module not available; falling back to composer"],
    };
  }

  const contactsNotified: string[] = [];
  const notifyErrors: string[] = [];

  for (const phone of cleaned) {
    try {
      const result = await Promise.resolve(directModule.sendSMS(phone, message));
      if (result === false) {
        notifyErrors.push(`Direct SMS failed for ${phone}`);
      } else {
        contactsNotified.push(phone);
      }
    } catch (error: any) {
      notifyErrors.push(`Direct SMS failed for ${phone}: ${error?.message || "Unknown error"}`);
    }
  }

  return {
    modeUsed: contactsNotified.length > 0 ? "direct" : "failed",
    contactsAttempted: cleaned,
    contactsNotified,
    notifyErrors,
  };
}

export async function notifyContacts(
  contacts: EmergencyContact[],
  message: string,
  mode: SmsMode
): Promise<NotifyResult> {
  const sorted = sortByPriority(contacts);
  const phones = sorted.map((contact) => contact.phone);

  if (mode === "direct") {
    return sendDirectSms(phones, message);
  }

  return openComposerSms(phones, message);
}

export async function triggerEmergencyFlow(
  params: TriggerEmergencyParams
): Promise<TriggerEmergencyResult> {
  const sortedContacts = sortByPriority(params.contacts);
  if (sortedContacts.length === 0) {
    throw new Error("Add emergency contacts first");
  }

  const timestamp = new Date();
  const modePreference = getConfiguredMode(params.modePreference);
  const location = await getCurrentLocationWithTimeout(params.locationTimeoutMs || 12000);
  const message = buildEmergencyMessage(
    location.latitude,
    location.longitude,
    timestamp,
    params.batteryPercent
  );

  let notify = await notifyContacts(sortedContacts, message, modePreference);

  if (modePreference === "direct" && notify.modeUsed === "failed") {
    const fallback = await notifyContacts(sortedContacts, message, "composer");
    notify = {
      ...fallback,
      notifyErrors: [...notify.notifyErrors, ...fallback.notifyErrors],
    };
  }

  return {
    message,
    location,
    notify,
    topPriorityContact: sortedContacts[0] || null,
  };
}
