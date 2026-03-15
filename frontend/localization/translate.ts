import { useStore } from "@/store";
import { messages, type MessageKey } from "./messages";

export const isMessageKey = (value: string): value is MessageKey =>
  Object.prototype.hasOwnProperty.call(messages, value);

export const translate = (messageKey: MessageKey): string => {
  const language = useStore.getState().language;
  return messages[messageKey]?.[language] ?? messages[messageKey]?.en ?? messageKey;
};

export const translateIfKey = (value: string): string => {
  if (!isMessageKey(value)) return value;
  return translate(value);
};
