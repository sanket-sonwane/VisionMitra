import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from 'zustand';
import { createJSONStorage, persist } from "zustand/middleware";
import type { SupportedLanguage } from "@/localization/messages";

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
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  currentSession: NavigationSession | null;
  setCurrentSession: (session: NavigationSession | null) => void;
  emergencyContacts: EmergencyContact[];
  setEmergencyContacts: (contacts: EmergencyContact[]) => void;
  addEmergencyContact: (contact: EmergencyContact) => void;
  removeEmergencyContact: (id: string) => void;
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      userId: "demo_user",
      setUserId: (id) => set({ userId: id }),
      isOnlineMode: true,
      toggleMode: () => set((state) => ({ isOnlineMode: !state.isOnlineMode })),
      language: "en",
      setLanguage: (language) => set({ language }),
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
    }),
    {
      name: "visionmitra-settings",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ language: state.language }),
    }
  )
);
