import { useStore, type AppLanguage } from "@/store";

type LocalizedText = Record<AppLanguage, string>;

const localized = (value: LocalizedText): string => {
  const language = useStore.getState().language;
  return value[language] ?? value.en;
};

export const destinationSetText = (destination: string): string =>
  localized({
    en: `Destination set to ${destination}.`,
    hi: `गंतव्य ${destination} सेट किया गया।`,
    gu: `ગંતવ્ય ${destination} સેટ થયું.`,
  });

export const destinationFoundText = (
  displayName: string,
  distanceLabel: string
): string =>
  localized({
    en: `Found ${displayName}. Distance ${distanceLabel}. Planning journey.`,
    hi: `${displayName} मिला। दूरी ${distanceLabel}। यात्रा की योजना बनाई जा रही है।`,
    gu: `${displayName} મળ્યું. અંતર ${distanceLabel}. મુસાફરીની યોજના બનાવી રહ્યા છીએ.`,
  });

export const directJourneyPlanText = (
  distanceLabel: string,
  timeLabel: string
): string =>
  localized({
    en: `Direct walk recommended. Total distance ${distanceLabel}. Estimated time ${timeLabel}.`,
    hi: `सीधे पैदल जाने की सलाह है। कुल दूरी ${distanceLabel}। अनुमानित समय ${timeLabel}।`,
    gu: `સીધી ચાલવાની ભલામણ છે. કુલ અંતર ${distanceLabel}. અંદાજિત સમય ${timeLabel}.`,
  });

export const segmentedJourneyPlanText = (
  segmentCount: number,
  originStopName: string,
  destinationStopName: string,
  distanceLabel: string,
  timeLabel: string
): string =>
  localized({
    en: `Journey planned with ${segmentCount} segments. Using ${originStopName} to ${destinationStopName}. Total distance ${distanceLabel}. Estimated time ${timeLabel}.`,
    hi: `${segmentCount} खंडों के साथ यात्रा योजना तैयार है। ${originStopName} से ${destinationStopName} तक। कुल दूरी ${distanceLabel}। अनुमानित समय ${timeLabel}।`,
    gu: `${segmentCount} વિભાગો સાથે મુસાફરીની યોજના તૈયાર છે. ${originStopName} થી ${destinationStopName} સુધી. કુલ અંતર ${distanceLabel}. અંદાજિત સમય ${timeLabel}.`,
  });

export const navigationStartedText = (instruction: string): string =>
  localized({
    en: `Navigation started. ${instruction}`,
    hi: `नेविगेशन शुरू हुआ। ${instruction}`,
    gu: `નેવિગેશન શરૂ થયું. ${instruction}`,
  });

export const contactRemovedText = (name: string): string =>
  localized({
    en: `${name} removed.`,
    hi: `${name} हटाया गया।`,
    gu: `${name} દૂર કરવામાં આવ્યો.`,
  });

export const callingContactText = (name: string): string =>
  localized({
    en: `Calling ${name}.`,
    hi: `${name} को कॉल किया जा रहा है।`,
    gu: `${name} ને કૉલ કરી રહ્યા છીએ.`,
  });

export const sosStatusSummaryText = (
  locationAvailable: boolean,
  notifyModeUsed: "direct" | "composer" | "failed"
): string => {
  const locationText = locationAvailable
    ? localized({
        en: "Location shared.",
        hi: "लोकेशन साझा की गई।",
        gu: "સ્થાન શેર કરવામાં આવ્યું.",
      })
    : localized({
        en: "Location unavailable, but alert message prepared.",
        hi: "लोकेशन उपलब्ध नहीं है, लेकिन अलर्ट संदेश तैयार है।",
        gu: "સ્થાન ઉપલબ્ધ નથી, પરંતુ એલર્ટ સંદેશ તૈયાર છે.",
      });

  const notifyText =
    notifyModeUsed === "failed"
      ? localized({
          en: "Unable to open SMS automatically. Please call manually.",
          hi: "SMS अपने-आप नहीं खुल सका। कृपया मैन्युअली कॉल करें।",
          gu: "SMS આપમેળે ખૂલ્યો નથી. કૃપા કરીને હાથેથી કૉલ કરો.",
        })
      : notifyModeUsed === "direct"
      ? localized({
          en: "Direct SMS attempted for emergency contacts.",
          hi: "आपातकालीन संपर्कों को डायरेक्ट SMS भेजने का प्रयास किया गया।",
          gu: "આપાત્કાલીન સંપર્કો માટે સીધી SMS મોકલવાનો પ્રયાસ કર્યો.",
        })
      : localized({
          en: "Opened SMS composer for emergency contacts.",
          hi: "आपातकालीन संपर्कों के लिए SMS कंपोज़र खोला गया।",
          gu: "આપાત્કાલીન સંપર્કો માટે SMS કમ્પોઝર ખોલ્યું.",
        });

  const localProcessingText = localized({
    en: "SOS handled locally on this device.",
    hi: "SOS इस डिवाइस पर स्थानीय रूप से संभाला गया।",
    gu: "SOS આ ઉપકરણ પર સ્થાનિક રીતે સંભાળવામાં આવ્યું.",
  });

  return `${locationText} ${notifyText} ${localProcessingText}`;
};
