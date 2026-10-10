import { create } from "zustand";
import type { NavigationSession } from "@/utils/types";

interface Store {
  userId: string | null;
  setUserId: (id: string) => void;
  isOnlineMode: boolean;
  toggleMode: () => void;
  currentSession: NavigationSession | null;
  setCurrentSession: (session: NavigationSession | null) => void;
}

export const useStore = create<Store>((set) => ({
  userId: "demo_user",
  setUserId: (id) => set({ userId: id }),
  isOnlineMode: true,
  toggleMode: () => set((state) => ({ isOnlineMode: !state.isOnlineMode })),
  currentSession: null,
  setCurrentSession: (session) => set({ currentSession: session }),
}));
