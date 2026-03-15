import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { VoiceController } from "@/voice/voiceController";
import { useStore } from "@/store";

export default function RootLayout() {
  const router = useRouter();
  const voiceControllerRef = useRef<VoiceController | null>(null);
  const voiceCommandsEnabled = useStore((state) => state.voiceCommandsEnabled);

  useEffect(() => {
    const voiceController = new VoiceController({
      navigateToRoutePlanner: () => router.push("/navigate"),
      navigateToEmergency: () => router.push("/emergency"),
      navigateToHome: () => router.push("/"),
    });

    voiceControllerRef.current = voiceController;
    if (useStore.getState().voiceCommandsEnabled) {
      void voiceController.start();
    }

    return () => {
      voiceController.stop();
      voiceControllerRef.current = null;
    };
  }, [router]);

  useEffect(() => {
    const voiceController = voiceControllerRef.current;
    if (!voiceController) return;

    if (voiceCommandsEnabled) {
      void voiceController.start();
      return;
    }

    voiceController.stop();
  }, [voiceCommandsEnabled]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
