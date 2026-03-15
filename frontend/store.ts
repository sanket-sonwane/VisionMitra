import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from 'zustand';

const LANGUAGE_STORAGE_KEY = "@visionmitra/language";
const EMERGENCY_CONTACTS_STORAGE_KEY = "@visionmitra/emergency-contacts";
const VOICE_COMMANDS_ENABLED_STORAGE_KEY = "@visionmitra/voice-commands-enabled";

export type AppLanguage = "en" | "hi" | "gu";

const isValidLanguage = (value: string | null): value is AppLanguage =>
  value === "en" || value === "hi" || value === "gu";

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
}

const isValidEmergencyContact = (value: unknown): value is EmergencyContact => {
  if (!value || typeof value !== "object") return false;

  const contact = value as Record<string, unknown>;
  return (
    typeof contact.id === "string" &&
    typeof contact.name === "string" &&
    typeof contact.phone === "string" &&
    typeof contact.relationship === "string" &&
    typeof contact.priority === "number"
  );
};

const persistEmergencyContacts = (contacts: EmergencyContact[]) => {
  AsyncStorage.setItem(EMERGENCY_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)).catch(
    (error) => {
      console.warn("[STORE] Failed to persist emergency contacts:", error);
    }
  );
};

interface NavigationSession {
  id: string;
  user_id: string;
  start_location: any;
  destination?: any;
  destination_name?: string;
  journey_plan?: any;
  current_segment_index?: number;
  status: string;
  mode: string;
  started_at: string;
}

interface Store {
  userId: string | null;
  setUserId: (id: string) => void;
  isOnlineMode: boolean;
  toggleMode: () => void;
  voiceCommandsEnabled: boolean;
  setVoiceCommandsEnabled: (enabled: boolean) => void;
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  currentSession: NavigationSession | null;
  setCurrentSession: (session: NavigationSession | null) => void;
  emergencyContacts: EmergencyContact[];
  setEmergencyContacts: (contacts: EmergencyContact[]) => void;
  addEmergencyContact: (contact: EmergencyContact) => void;
  removeEmergencyContact: (id: string) => void;
}

export const useStore = create<Store>((set) => ({
  userId: "demo_user",
  setUserId: (id) => set({ userId: id }),
  isOnlineMode: true,
  toggleMode: () => set((state) => ({ isOnlineMode: !state.isOnlineMode })),
  voiceCommandsEnabled: false,
  setVoiceCommandsEnabled: (enabled) => {
    set({ voiceCommandsEnabled: enabled });
    AsyncStorage.setItem(VOICE_COMMANDS_ENABLED_STORAGE_KEY, JSON.stringify(enabled)).catch(
      (error) => {
        console.warn("[STORE] Failed to persist voice command setting:", error);
      }
    );
  },
  language: "en",
  setLanguage: (language) => {
    set({ language });
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language).catch((error) => {
      console.warn("[STORE] Failed to persist language:", error);
    });
  },
  currentSession: null,
  setCurrentSession: (session) => set({ currentSession: session }),
  emergencyContacts: [],
  setEmergencyContacts: (contacts) => {
    set({ emergencyContacts: contacts });
    persistEmergencyContacts(contacts);
  },
  addEmergencyContact: (contact) =>
    set((state) => {
      const updatedContacts = [...state.emergencyContacts, contact];
      persistEmergencyContacts(updatedContacts);
      return { emergencyContacts: updatedContacts };
    }),
  removeEmergencyContact: (id) =>
    set((state) => {
      const updatedContacts = state.emergencyContacts.filter((c) => c.id !== id);
      persistEmergencyContacts(updatedContacts);
      return { emergencyContacts: updatedContacts };
    }),
}));

const hydrateLanguage = async () => {
  try {
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isValidLanguage(savedLanguage)) {
      useStore.setState({ language: savedLanguage });
    }
  } catch (error) {
    console.warn("[STORE] Failed to load saved language:", error);
  }
};

const hydrateEmergencyContacts = async () => {
  try {
    const savedContacts = await AsyncStorage.getItem(EMERGENCY_CONTACTS_STORAGE_KEY);
    if (!savedContacts) return;

    const parsedContacts: unknown = JSON.parse(savedContacts);
    if (!Array.isArray(parsedContacts)) return;

    const validContacts = parsedContacts.filter(isValidEmergencyContact);
    useStore.setState({ emergencyContacts: validContacts });
  } catch (error) {
    console.warn("[STORE] Failed to load saved emergency contacts:", error);
  }
};

const hydrateVoiceCommandSetting = async () => {
  try {
    const savedSetting = await AsyncStorage.getItem(VOICE_COMMANDS_ENABLED_STORAGE_KEY);
    if (savedSetting === null) return;

    const enabled: unknown = JSON.parse(savedSetting);
    if (typeof enabled === "boolean") {
      useStore.setState({ voiceCommandsEnabled: enabled });
    }
  } catch (error) {
    console.warn("[STORE] Failed to load voice command setting:", error);
  }
};

void hydrateLanguage();
void hydrateEmergencyContacts();
void hydrateVoiceCommandSetting();
