// App-level VoiceEngine provider
// Wires voice commands to actual navigation, detection, and SOS modules

import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';

import { useStore } from '@/store';
import { useVoiceEngine } from './useVoiceEngine';
import type { VoiceEngineCallbacks, VoiceEngineState, VoiceState } from './types';

interface VoiceCtx {
  state: VoiceEngineState;
  ready: boolean;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
}

const VoiceContext = createContext<VoiceCtx>({
  state: {
    state: 'idle' as VoiceState,
    isWakeWordActive: false,
    lastCommand: null,
    error: null,
  },
  ready: false,
  stop: async () => {},
  restart: async () => {},
});

export function useVoiceContext() {
  return useContext(VoiceContext);
}

export function VoiceEngineProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setCurrentSession } = useStore();

  // --- Module callbacks -----------------------------------------------

  const startDetection = useCallback(() => {
    Speech.speak('Starting obstacle detection.');
    router.push('/camera' as any);
  }, [router]);

  const stopDetection = useCallback(() => {
    Speech.speak('Detection stopped.');
    // Camera screen reads isActive from its own state;
    // navigating away is the simplest "stop" action.
    router.push('/' as any);
  }, [router]);

  const startNavigation = useCallback(
    (location: string) => {
      Speech.speak(`Navigating to ${location}.`);
      // Push to navigate screen with destination pre-filled via query param
      router.push({ pathname: '/navigate' as any, params: { dest: location } });
    },
    [router]
  );

  const stopNavigation = useCallback(() => {
    Speech.speak('Navigation stopped.');
    setCurrentSession(null);
    router.push('/' as any);
  }, [router, setCurrentSession]);

  const speakCurrentLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Speech.speak('Location permission not granted.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const [place] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (place) {
        const parts = [place.street, place.district, place.city].filter(Boolean);
        Speech.speak(`You are near ${parts.join(', ')}.`);
      } else {
        Speech.speak(
          `Latitude ${loc.coords.latitude.toFixed(4)}, Longitude ${loc.coords.longitude.toFixed(4)}.`
        );
      }
    } catch {
      Speech.speak('Unable to determine your location.');
    }
  }, []);

  const triggerSOS = useCallback(() => {
    Speech.speak('Activating emergency SOS.');
    router.push('/emergency' as any);
  }, [router]);

  const callbacks = useMemo<VoiceEngineCallbacks>(
    () => ({
      startDetection,
      stopDetection,
      startNavigation,
      stopNavigation,
      speakCurrentLocation,
      triggerSOS,
    }),
    [startDetection, stopDetection, startNavigation, stopNavigation, speakCurrentLocation, triggerSOS]
  );

  const { state, ready, stop, restart } = useVoiceEngine(callbacks);

  const ctx = useMemo<VoiceCtx>(
    () => ({ state, ready, stop, restart }),
    [state, ready, stop, restart]
  );

  return <VoiceContext.Provider value={ctx}>{children}</VoiceContext.Provider>;
}
