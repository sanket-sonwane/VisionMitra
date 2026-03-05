// React hook for consuming VoiceEngine state and controls

import { useEffect, useRef, useState } from 'react';
import { VoiceEngine } from './VoiceEngine';
import type { VoiceEngineCallbacks, VoiceEngineState, VoiceState } from './types';

const DEFAULT_STATE: VoiceEngineState = {
  state: 'idle' as VoiceState,
  isWakeWordActive: false,
  lastCommand: null,
  error: null,
};

export function useVoiceEngine(callbacks: VoiceEngineCallbacks) {
  const engineRef = useRef<VoiceEngine | null>(null);
  const [state, setState] = useState<VoiceEngineState>(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let cancelled = false;
    const engine = new VoiceEngine();
    engineRef.current = engine;

    const unsubscribe = engine.subscribe((s) => {
      if (!cancelled) setState(s);
    });

    (async () => {
      try {
        // Wrap callbacks so the ref is always current
        await engine.initialize({
          startDetection: () => callbacksRef.current.startDetection(),
          stopDetection: () => callbacksRef.current.stopDetection(),
          startNavigation: (loc) => callbacksRef.current.startNavigation(loc),
          stopNavigation: () => callbacksRef.current.stopNavigation(),
          speakCurrentLocation: () => callbacksRef.current.speakCurrentLocation(),
          triggerSOS: () => callbacksRef.current.triggerSOS(),
        });
        if (!cancelled) {
          setReady(true);
          await engine.start();
        }
      } catch (err) {
        console.error('[useVoiceEngine] init failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const stop = async () => {
    await engineRef.current?.stop();
  };

  const restart = async () => {
    await engineRef.current?.start();
  };

  return { state, ready, stop, restart };
}
