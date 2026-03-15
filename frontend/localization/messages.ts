import type { AppLanguage } from "@/store";

export type MessageKey =
  | "PERSON_AHEAD"
  | "OBSTACLE_BLOCKING"
  | "CROWD_LEFT"
  | "CROWD_RIGHT"
  | "CAMERA_CALIBRATING"
  | "OBSTACLE_AHEAD_LEFT"
  | "OBSTACLE_AHEAD_RIGHT"
  | "CAUTION_SIDE_OBSTACLE"
  | "PATH_CLEAR"
  | "SEGMENTED_NAVIGATION_ACTIVE"
  | "CAMERA_MODE_ACTIVE"
  | "DESTINATION_REACHED"
  | "SEGMENT_COMPLETE"
  | "NAVIGATION_COMPLETE"
  | "ANALYZING_SURROUNDINGS"
  | "ANALYSIS_UNAVAILABLE"
  | "ANALYSIS_FAILED"
  | "CONTINUOUS_MONITORING_STARTED"
  | "CONTINUOUS_MONITORING_STOPPED"
  | "ANALYZE_ONCE_HINT"
  | "START_MONITORING_HINT"
  | "STOP_MONITORING_HINT"
  | "SETTINGS_INTRO"
  | "MODE_SWITCHED_ONLINE"
  | "MODE_SWITCHED_OFFLINE"
  | "VOICE_TEST_SAMPLE"
  | "HAPTIC_FEEDBACK_ENABLED"
  | "HAPTIC_FEEDBACK_DISABLED"
  | "LANGUAGE_SET_ENGLISH"
  | "LANGUAGE_SET_HINDI"
  | "LANGUAGE_SET_GUJARATI";

type MessageDictionary = Record<MessageKey, Record<AppLanguage, string>>;

export const messages: MessageDictionary = {
  PERSON_AHEAD: {
    en: "Person ahead. Move slightly.",
    hi: "आगे व्यक्ति है। थोड़ा हटकर चलें।",
    gu: "આગળ વ્યક્તિ છે. થોડું બાજુએ ખસો.",
  },
  OBSTACLE_BLOCKING: {
    en: "Obstacle blocking path. Stop.",
    hi: "रास्ता बाधित है। रुक जाइए।",
    gu: "રસ્તો અવરોધિત છે. અટકી જાવ.",
  },
  CROWD_LEFT: {
    en: "Crowd on the left.",
    hi: "बाईं तरफ भीड़ है।",
    gu: "ડાબી બાજુ ભીડ છે.",
  },
  CROWD_RIGHT: {
    en: "Crowd on the right.",
    hi: "दाईं तरफ भीड़ है।",
    gu: "જમણી બાજુ ભીડ છે.",
  },
  CAMERA_CALIBRATING: {
    en: "Camera is calibrating. Please hold steady.",
    hi: "कैमरा कैलिब्रेट हो रहा है। कृपया स्थिर रहें।",
    gu: "કેમેરા કેલિબ્રેટ થઈ રહ્યો છે. કૃપા કરીને સ્થિર રહો.",
  },
  OBSTACLE_AHEAD_LEFT: {
    en: "Obstacle ahead. Move left.",
    hi: "आगे बाधा है। बाईं ओर जाएँ।",
    gu: "આગળ અવરોધ છે. ડાબી તરફ જવો.",
  },
  OBSTACLE_AHEAD_RIGHT: {
    en: "Obstacle ahead. Move right.",
    hi: "आगे बाधा है। दाईं ओर जाएँ।",
    gu: "આગળ અવરોધ છે. જમણી તરફ જવો.",
  },
  CAUTION_SIDE_OBSTACLE: {
    en: "Caution. Side obstacle nearby. Keep centered.",
    hi: "सावधान। बगल में बाधा है। बीच में रहें।",
    gu: "સાવધાન. બાજુમાં અવરોધ છે. મધ્યમાં રહો.",
  },
  PATH_CLEAR: {
    en: "Path clear. Continue forward.",
    hi: "रास्ता साफ है। आगे बढ़ते रहें।",
    gu: "રસ્તો સાફ છે. આગળ વધો.",
  },
  SEGMENTED_NAVIGATION_ACTIVE: {
    en: "Segmented navigation active. Starting first segment.",
    hi: "खंडित नेविगेशन सक्रिय है। पहला खंड शुरू हो रहा है।",
    gu: "વિભાગીય નેવિગેશન સક્રિય છે. પહેલો વિભાગ શરૂ થઈ રહ્યો છે.",
  },
  CAMERA_MODE_ACTIVE: {
    en: "Camera mode. Tap analyze button to detect obstacles.",
    hi: "कैमरा मोड सक्रिय है। बाधाओं का पता लगाने के लिए विश्लेषण बटन दबाएँ।",
    gu: "કેમેરા મોડ સક્રિય છે. અવરોધ શોધવા માટે વિશ્લેષણ બટન દબાવો.",
  },
  DESTINATION_REACHED: {
    en: "You have arrived at your destination.",
    hi: "आप अपने गंतव्य पर पहुँच गए हैं।",
    gu: "તમે તમારા ગંતવ્યે પહોંચી ગયા છો.",
  },
  SEGMENT_COMPLETE: {
    en: "Segment complete. Starting next segment.",
    hi: "खंड पूरा हुआ। अगला खंड शुरू हो रहा है।",
    gu: "વિભાગ પૂર્ણ થયો. આગળનો વિભાગ શરૂ થઈ રહ્યો છે.",
  },
  NAVIGATION_COMPLETE: {
    en: "Navigation complete. You have arrived at your destination.",
    hi: "नेविगेशन पूरा हुआ। आप अपने गंतव्य पर पहुँच गए हैं।",
    gu: "નેવિગેશન પૂર્ણ થયું. તમે તમારા ગંતવ્યે પહોંચી ગયા છો.",
  },
  ANALYZING_SURROUNDINGS: {
    en: "Analyzing surroundings.",
    hi: "आस-पास का विश्लेषण किया जा रहा है।",
    gu: "આસપાસનું વિશ્લેષણ થઈ રહ્યું છે.",
  },
  ANALYSIS_UNAVAILABLE: {
    en: "Unable to analyze image. Proceed with caution.",
    hi: "छवि का विश्लेषण नहीं हो सका। सावधानी से आगे बढ़ें।",
    gu: "છબીનું વિશ્લેષણ કરી શકાયું નથી. સાવચેતીથી આગળ વધો.",
  },
  ANALYSIS_FAILED: {
    en: "Analysis failed. Please try again.",
    hi: "विश्लेषण विफल हुआ। कृपया फिर से प्रयास करें।",
    gu: "વિશ્લેષણ નિષ્ફળ ગયું. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
  CONTINUOUS_MONITORING_STARTED: {
    en: "Continuous monitoring started.",
    hi: "निरंतर निगरानी शुरू हुई।",
    gu: "સતત મોનિટરિંગ શરૂ થયું.",
  },
  CONTINUOUS_MONITORING_STOPPED: {
    en: "Continuous monitoring stopped.",
    hi: "निरंतर निगरानी बंद हुई।",
    gu: "સતત મોનિટરિંગ બંધ થયું.",
  },
  ANALYZE_ONCE_HINT: {
    en: "Analyze once. Takes a photo and analyzes obstacles.",
    hi: "एक बार विश्लेषण करें। यह फोटो लेकर बाधाओं का विश्लेषण करता है।",
    gu: "એક વખત વિશ્લેષણ કરો. તે ફોટો લઈને અવરોધોનું વિશ્લેષણ કરે છે.",
  },
  START_MONITORING_HINT: {
    en: "Start continuous monitoring.",
    hi: "निरंतर निगरानी शुरू करें।",
    gu: "સતત મોનિટરિંગ શરૂ કરો.",
  },
  STOP_MONITORING_HINT: {
    en: "Stop continuous monitoring.",
    hi: "निरंतर निगरानी रोकें।",
    gu: "સતત મોનિટરિંગ બંધ કરો.",
  },
  SETTINGS_INTRO: {
    en: "Settings. Configure your preferences.",
    hi: "सेटिंग्स। अपनी प्राथमिकताएँ कॉन्फ़िगर करें।",
    gu: "સેટિંગ્સ. તમારી પસંદગીઓ ગોઠવો.",
  },
  MODE_SWITCHED_ONLINE: {
    en: "Switched to online mode.",
    hi: "ऑनलाइन मोड पर स्विच किया गया।",
    gu: "ઓનલાઇન મોડ પર સ્વિચ થયું.",
  },
  MODE_SWITCHED_OFFLINE: {
    en: "Switched to offline mode.",
    hi: "ऑफ़लाइन मोड पर स्विच किया गया।",
    gu: "ઓફલાઇન મોડ પર સ્વિચ થયું.",
  },
  VOICE_TEST_SAMPLE: {
    en: "This is a voice test. Adjust speech rate in settings.",
    hi: "यह एक वॉइस टेस्ट है। सेटिंग्स में स्पीच रेट समायोजित करें।",
    gu: "આ અવાજ પરીક્ષણ છે. સેટિંગ્સમાં સ્પીચ રેટ ગોઠવો.",
  },
  HAPTIC_FEEDBACK_ENABLED: {
    en: "Haptic feedback enabled.",
    hi: "हैप्टिक फीडबैक सक्षम किया गया।",
    gu: "હેપ્ટિક ફીડબેક સક્રિય થયું.",
  },
  HAPTIC_FEEDBACK_DISABLED: {
    en: "Haptic feedback disabled.",
    hi: "हैप्टिक फीडबैक अक्षम किया गया।",
    gu: "હેપ્ટિક ફીડબેક નિષ્ક્રિય થયું.",
  },
  LANGUAGE_SET_ENGLISH: {
    en: "Language set to English.",
    hi: "भाषा अंग्रेज़ी पर सेट की गई।",
    gu: "ભાષા અંગ્રેજી પર સેટ થઈ.",
  },
  LANGUAGE_SET_HINDI: {
    en: "Language set to Hindi.",
    hi: "भाषा हिंदी पर सेट की गई।",
    gu: "ભાષા હિન્દી પર સેટ થઈ.",
  },
  LANGUAGE_SET_GUJARATI: {
    en: "Language set to Gujarati.",
    hi: "भाषा गुजराती पर सेट की गई।",
    gu: "ભાષા ગુજરાતી પર સેટ થઈ.",
  },
};
