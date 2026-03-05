# Wake Word Assets

This directory holds Picovoice Porcupine `.ppn` keyword model files.

## How to generate `visionmitra.ppn`

1. Go to [Picovoice Console](https://console.picovoice.ai/)
2. Sign up for a **free developer account** (gives you an Access Key)
3. Navigate to **Porcupine** → **Custom Keywords**
4. Create a new keyword:
   - **Phrase**: `visionmitra`
   - **Language**: English
   - **Platform**: Android (and/or iOS if targeting both)
5. Download the generated `.ppn` file
6. Rename it to `visionmitra.ppn` and place it in this directory:
   ```
   frontend/assets/wakewords/visionmitra.ppn
   ```
7. Add your Access Key to `frontend/.env`:
   ```
   EXPO_PUBLIC_PORCUPINE_ACCESS_KEY=<your-key-here>
   ```

## Fallback for development

If `visionmitra.ppn` is not present, `WakeWordService` falls back to
the built-in keyword **"Porcupine"** — say "Porcupine" instead of
"visionmitra" during development.

## Metro bundling

The `metro.config.js` already includes `ppn` in `assetExts`, so Metro
will bundle this file into the native app automatically.
