// Porcupine wake word detection service
// Uses @picovoice/porcupine-react-native v4 for "visionmitra" wake word
// The .ppn keyword file is loaded from assets/wakewords/ via require()

import {
  PorcupineManager,
  BuiltInKeywords,
} from '@picovoice/porcupine-react-native';

const PORCUPINE_ACCESS_KEY = process.env.EXPO_PUBLIC_PORCUPINE_ACCESS_KEY ?? '';

// Resolve the custom .ppn keyword asset bundled via Metro.
// The file must exist at assets/wakewords/visionmitra.ppn
// Generate it at https://console.picovoice.ai/ for each target platform.
const KEYWORD_ASSET = require('../../assets/wakewords/visionmitra.ppn');

type WakeCallback = () => void;
type ErrorCallback = (error: Error) => void;

export class WakeWordService {
  private manager: PorcupineManager | null = null;
  private onWake: WakeCallback | null = null;
  private onError: ErrorCallback | null = null;
  private running = false;

  async initialize(onWake: WakeCallback, onError: ErrorCallback): Promise<void> {
    this.onWake = onWake;
    this.onError = onError;

    if (!PORCUPINE_ACCESS_KEY) {
      throw new Error(
        'Porcupine access key not set. Add EXPO_PUBLIC_PORCUPINE_ACCESS_KEY to .env'
      );
    }

    console.log('[Voice] Initializing Porcupine wake word engine');

    try {
      // Load custom "visionmitra" keyword from bundled asset
      // v4 signature: (accessKey, keywordPaths[], detectionCb, errorCb?, modelPath?, device?, sensitivities?)
      this.manager = await PorcupineManager.fromKeywordPaths(
        PORCUPINE_ACCESS_KEY,
        [KEYWORD_ASSET],
        this.handleDetection,
        this.handleError,
        undefined, // modelPath — use default
        undefined, // device — use default (CPU)
        [0.7]      // sensitivities: 0..1
      );
      console.log('[Voice] Porcupine initialized with custom keyword "visionmitra"');
    } catch (err) {
      // Fallback: use built-in "PORCUPINE" keyword for development/testing
      console.warn(
        '[Voice] Custom wake word asset not found — falling back to built-in "PORCUPINE" keyword for dev',
        err
      );
      this.manager = await PorcupineManager.fromBuiltInKeywords(
        PORCUPINE_ACCESS_KEY,
        [BuiltInKeywords.PORCUPINE],
        this.handleDetection,
        this.handleError,
        undefined, // modelPath
        undefined, // device
        [0.7]      // sensitivities
      );
      console.log('[Voice] Porcupine initialized with built-in fallback keyword');
    }
  }

  private handleDetection = (_keywordIndex: number) => {
    console.log('[Voice] Wake word detected');
    this.onWake?.();
  };

  private handleError = (error: any) => {
    console.error('[Voice] Porcupine error:', error);
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  async start(): Promise<void> {
    if (!this.manager) {
      throw new Error('WakeWordService not initialized. Call initialize() first.');
    }
    if (this.running) return;

    await this.manager.start();
    this.running = true;
    console.log('[Voice] Wake word listening started');
  }

  async stop(): Promise<void> {
    if (!this.manager || !this.running) return;

    await this.manager.stop();
    this.running = false;
    console.log('[Voice] Wake word listening stopped');
  }

  async destroy(): Promise<void> {
    await this.stop();
    if (this.manager) {
      await this.manager.delete();
      this.manager = null;
    }
    this.onWake = null;
    this.onError = null;
    console.log('[Voice] WakeWordService destroyed');
  }

  isRunning(): boolean {
    return this.running;
  }
}
