// VoiceEngine orchestrator
// Manages the lifecycle: wake word -> prompt -> command listen -> parse -> route -> restart
//
// State machine:
//   IDLE -> WAKE_LISTENING -> [wake detected] -> SPEAKING ("Yes, how can I help?")
//        -> COMMAND_LISTENING (6 s) -> PROCESSING -> route command -> WAKE_LISTENING
//
// Detection pipeline and navigation continue running independently throughout.

import * as Speech from 'expo-speech';

import { WakeWordService } from './WakeWordService';
import { SpeechRecognitionService } from './SpeechRecognitionService';
import { parseCommand } from './CommandParser';
import { routeCommand } from './CommandRouter';
import type {
  VoiceState,
  VoiceEngineState,
  VoiceEngineCallbacks,
  VoiceCommand,
} from './types';

type StateListener = (state: VoiceEngineState) => void;

export class VoiceEngine {
  private wakeService = new WakeWordService();
  private speechService = new SpeechRecognitionService();
  private callbacks: VoiceEngineCallbacks | null = null;
  private stateListeners = new Set<StateListener>();
  private currentState: VoiceEngineState = {
    state: 'idle' as VoiceState,
    isWakeWordActive: false,
    lastCommand: null,
    error: null,
  };
  private initialized = false;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async initialize(callbacks: VoiceEngineCallbacks): Promise<void> {
    if (this.initialized) return;
    this.callbacks = callbacks;

    console.log('[Voice] Initializing VoiceEngine');

    await this.wakeService.initialize(
      () => this.onWakeWordDetected(),
      (err) => this.onError(err)
    );

    await this.speechService.initialize();
    this.initialized = true;
    console.log('[Voice] VoiceEngine initialized successfully');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('VoiceEngine not initialized. Call initialize() first.');
    }
    console.log('[Voice] VoiceEngine starting');
    await this.enterWakeListening();
  }

  async stop(): Promise<void> {
    console.log('[Voice] VoiceEngine stopping');
    await this.wakeService.stop();
    await this.speechService.stopListening();
    this.updateState({ state: 'idle' as VoiceState, isWakeWordActive: false });
  }

  async destroy(): Promise<void> {
    await this.stop();
    await this.wakeService.destroy();
    await this.speechService.destroy();
    this.stateListeners.clear();
    this.callbacks = null;
    this.initialized = false;
    console.log('[Voice] VoiceEngine destroyed');
  }

  // ------------------------------------------------------------------
  // State management
  // ------------------------------------------------------------------

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.currentState);
    return () => this.stateListeners.delete(listener);
  }

  getState(): VoiceEngineState {
    return this.currentState;
  }

  private updateState(partial: Partial<VoiceEngineState>): void {
    this.currentState = { ...this.currentState, ...partial };
    for (const listener of this.stateListeners) {
      listener(this.currentState);
    }
  }

  // ------------------------------------------------------------------
  // Wake word phase
  // ------------------------------------------------------------------

  private async enterWakeListening(): Promise<void> {
    console.log('[Voice] Entering wake word listening mode');
    this.updateState({
      state: 'wake_listening' as VoiceState,
      isWakeWordActive: true,
      error: null,
    });
    await this.wakeService.start();
  }

  private async onWakeWordDetected(): Promise<void> {
    console.log('[Voice] Wake word detected — pausing engine');

    // 1. Pause wake word detection to avoid overlap
    await this.wakeService.stop();
    this.updateState({
      state: 'speaking' as VoiceState,
      isWakeWordActive: false,
    });

    // 2. Prompt the user
    console.log('[Voice] Speaking prompt: "Yes, how can I help?"');
    await this.speak('Yes, how can I help?');

    // 3. Transition to command listening
    await this.enterCommandListening();
  }

  // ------------------------------------------------------------------
  // Command listening phase (6 s window)
  // ------------------------------------------------------------------

  private async enterCommandListening(): Promise<void> {
    console.log('[Voice] Listening for command (6 s window)');
    this.updateState({ state: 'command_listening' as VoiceState });

    await this.speechService.startListening(
      (transcript) => this.onCommandReceived(transcript),
      () => this.onCommandTimeout(),
      (err) => this.onError(err)
    );
  }

  private async onCommandReceived(transcript: string): Promise<void> {
    console.log(`[Voice] Heard command: "${transcript}"`);
    this.updateState({ state: 'processing' as VoiceState });

    const command: VoiceCommand = parseCommand(transcript);
    this.updateState({ lastCommand: command });

    console.log(`[Voice] Parsed command type: ${command.type}`, command.params ?? '');

    if (command.type === 'unknown' || !this.callbacks) {
      console.log('[Voice] Command not recognized');
      await this.speak("Sorry, I didn't understand.");
    } else {
      console.log(`[Voice] Routing command: ${command.type}`);
      const handled = routeCommand(command, this.callbacks);
      if (!handled) {
        console.log('[Voice] Routing failed — command unhandled');
        await this.speak("Sorry, I didn't understand.");
      }
    }

    // Return to wake word listening
    console.log('[Voice] Command cycle complete — returning to wake mode');
    await this.enterWakeListening();
  }

  private async onCommandTimeout(): Promise<void> {
    console.log('[Voice] Command listening timed out (6 s)');
    await this.speak('Listening stopped.');
    await this.enterWakeListening();
  }

  // ------------------------------------------------------------------
  // Error handling
  // ------------------------------------------------------------------

  private async onError(error: Error): Promise<void> {
    console.error('[Voice] Error:', error.message);
    this.updateState({
      state: 'error' as VoiceState,
      error: error.message,
    });

    // Auto-recover: try returning to wake listening after a brief delay
    setTimeout(async () => {
      try {
        console.log('[Voice] Attempting auto-recovery');
        await this.enterWakeListening();
      } catch {
        console.error('[Voice] Auto-recovery failed');
      }
    }, 2000);
  }

  // ------------------------------------------------------------------
  // TTS helper
  // ------------------------------------------------------------------

  private speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      Speech.speak(text, {
        language: 'en',
        pitch: 1.0,
        rate: 1.0,
        onDone: resolve,
        onError: () => resolve(), // resolve anyway so the engine keeps moving
      });
    });
  }
}
