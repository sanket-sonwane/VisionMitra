import { Stack } from 'expo-router';
import { VoiceEngineProvider } from '@/voice/VoiceEngineProvider';

export default function RootLayout() {
  return (
    <VoiceEngineProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </VoiceEngineProvider>
  );
}
