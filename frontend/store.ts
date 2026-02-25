import { create } from 'zustand';

interface NavigationSession {
  id: string;
  user_id: string;
  start_location: any;
  destination?: any;
  destination_name?: string;
  status: string;
  mode: string;
  started_at: string;
}

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
