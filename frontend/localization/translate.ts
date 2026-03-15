import { messages, type MessageKey } from "@/localization/messages";
import { useStore } from "@/store";

export function translate(messageKey: MessageKey): string {
  const language = useStore.getState().language;
  return messages[messageKey]?.[language] ?? messages[messageKey]?.en ?? messageKey;
}
