// Speech recognition service for command listening
// Uses expo-speech-recognition with a 6-second timeout window

const COMMAND_TIMEOUT_MS = 6000;

type ResultCallback = (transcript: string) => void;
type TimeoutCallback = () => void;
type ErrorCallback = (error: Error) => void;

export class SpeechRecognitionService {
  private speechModule: any = null;
  private listener: any = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private onResult: ResultCallback | null = null;
  private onTimeout: TimeoutCallback | null = null;
  private onError: ErrorCallback | null = null;
  private listening = false;

  async initialize(): Promise<boolean> {
    try {
      this.speechModule = await import('expo-speech-recognition');
      console.log('[Voice] Speech recognition module loaded');
      return this.speechModule != null;
    } catch {
      console.warn('[Voice] expo-speech-recognition not available');
      return false;
    }
  }

  async startListening(
    onResult: ResultCallback,
    onTimeout: TimeoutCallback,
    onError: ErrorCallback
  ): Promise<void> {
    if (!this.speechModule) {
      onError(new Error('Speech recognition not initialized'));
      return;
    }

    if (this.listening) {
      await this.stopListening();
    }

    this.onResult = onResult;
    this.onTimeout = onTimeout;
    this.onError = onError;
    this.listening = true;

    console.log(`[Voice] Listening for command (${COMMAND_TIMEOUT_MS / 1000}s window)`);

    // Set up the 6-second timeout
    this.timeoutHandle = setTimeout(() => {
      if (this.listening) {
        console.log('[Voice] Command listening timed out');
        this.stopListening();
        this.onTimeout?.();
      }
    }, COMMAND_TIMEOUT_MS);

    try {
      const ExpoSpeechRecognition = this.speechModule.ExpoSpeechRecognitionModule
        ?? this.speechModule.default
        ?? this.speechModule;

      // Listen for results
      this.listener = ExpoSpeechRecognition.addListener?.(
        'result',
        (event: any) => {
          if (!this.listening) return;

          const isFinal = event.isFinal ?? true;
          const transcript =
            event.results?.[0]?.transcript ??
            event.value?.[0] ??
            '';

          if (isFinal && transcript) {
            console.log(`[Voice] Speech recognized: "${transcript}"`);
            this.clearTimeout();
            this.listening = false;
            this.onResult?.(transcript);
            this.cleanup();
          }
        }
      );

      // Request permissions and start
      const permResult = await ExpoSpeechRecognition.requestPermissionsAsync?.();
      if (permResult && !permResult.granted) {
        throw new Error('Microphone permission denied');
      }

      ExpoSpeechRecognition.start?.({
        lang: 'en-IN',
        interimResults: false,
        maxAlternatives: 1,
        contextualStrings: [
          'start detection',
          'stop detection',
          'navigate to',
          'stop navigation',
          'where am I',
          'emergency',
        ],
      });
    } catch (err: any) {
      this.listening = false;
      this.clearTimeout();
      this.cleanup();
      console.error('[Voice] Speech recognition start error:', err);
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async stopListening(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    this.clearTimeout();

    try {
      const ExpoSpeechRecognition = this.speechModule?.ExpoSpeechRecognitionModule
        ?? this.speechModule?.default
        ?? this.speechModule;
      ExpoSpeechRecognition?.stop?.();
    } catch {
      // ignore cleanup errors
    }

    this.cleanup();
    console.log('[Voice] Speech recognition stopped');
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private cleanup(): void {
    if (this.listener) {
      this.listener.remove?.();
      this.listener = null;
    }
  }

  isListening(): boolean {
    return this.listening;
  }

  async destroy(): Promise<void> {
    await this.stopListening();
    this.speechModule = null;
    this.onResult = null;
    this.onTimeout = null;
    this.onError = null;
  }
}
