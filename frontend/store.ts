import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from 'zustand';

const LANGUAGE_STORAGE_KEY = "@visionmitra/language";

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
  setEmergencyContacts: (contacts) => set({ emergencyContacts: contacts }),
  addEmergencyContact: (contact) =>
    set((state) => ({ emergencyContacts: [...state.emergencyContacts, contact] })),
  removeEmergencyContact: (id) =>
    set((state) => ({
      emergencyContacts: state.emergencyContacts.filter((c) => c.id !== id),
    })),
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

void hydrateLanguage();
