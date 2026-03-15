export type SupportedLanguage = "en" | "hi" | "gu";

export type MessageKey =
  | "PERSON_AHEAD"
  | "OBSTACLE_BLOCKING"
  | "CROWD_LEFT"
  | "CROWD_RIGHT"
  | "CAMERA_CALIBRATING"
  | "DANGER_AHEAD"
  | "CAUTION_OBSTACLE"
  | "PATH_CLEAR"
  | "SEGMENT_NAV_ACTIVE"
  | "CAMERA_MODE_READY"
  | "DESTINATION_ARRIVED"
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
  | "HAPTIC_ENABLED"
  | "HAPTIC_DISABLED"
  | "VOICE_TEST_SAMPLE"
  | "HOW_TO_USE_GUIDE"
  | "DETECTION_LOADING"
  | "DETECTION_SLOW"
  | "DETECTION_ERROR_STOP";

export const messages: Record<MessageKey, Record<SupportedLanguage, string>> = {
  PERSON_AHEAD: {
    en: "Person ahead. Move carefully.",
    hi: "आगे व्यक्ति है। सावधानी से चलें।",
    gu: "આગળ વ્યક્તિ છે. સાવધાનીથી ચાલો.",
  },
  OBSTACLE_BLOCKING: {
    en: "Obstacle blocking path. Stop.",
    hi: "रास्ता बाधित है। रुकें।",
    gu: "રસ્તો અવરોધિત છે. રોકાઓ.",
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
  DANGER_AHEAD: {
    en: "Danger ahead. Proceed carefully.",
    hi: "आगे खतरा है। सावधानी से आगे बढ़ें।",
    gu: "આગળ જોખમ છે. સાવધાનીથી આગળ વધો.",
  },
  CAUTION_OBSTACLE: {
    en: "Caution. Obstacle nearby. Keep centered.",
    hi: "सावधान। पास में बाधा है। बीच में रहें।",
    gu: "સાવધાન. નજીક અવરોધ છે. મધ્યમાં રહો.",
  },
  PATH_CLEAR: {
    en: "Path clear. Continue forward.",
    hi: "रास्ता साफ है। आगे बढ़ते रहें।",
    gu: "રસ્તો સાફ છે. આગળ વધો.",
  },
  SEGMENT_NAV_ACTIVE: {
    en: "Segmented navigation active. Starting first segment.",
    hi: "खंड-आधारित नेविगेशन सक्रिय है। पहला खंड शुरू हो रहा है।",
    gu: "વિભાગીય નેવિગેશન સક્રિય છે. પ્રથમ વિભાગ શરૂ થાય છે.",
  },
  CAMERA_MODE_READY: {
    en: "Camera mode. Tap analyze button to detect obstacles.",
    hi: "कैमरा मोड। बाधाओं का पता लगाने के लिए विश्लेषण बटन दबाएं।",
    gu: "કેમેરા મોડ. અવરોધ શોધવા માટે એનાલાઇઝ બટન દબાવો.",
  },
  DESTINATION_ARRIVED: {
    en: "You have arrived at your destination.",
    hi: "आप अपने गंतव्य पर पहुंच गए हैं।",
    gu: "તમે તમારા ગંતવ્યે પહોંચી ગયા છો.",
  },
  SEGMENT_COMPLETE: {
    en: "Segment complete. Starting next segment.",
    hi: "खंड पूरा हुआ। अगला खंड शुरू हो रहा है।",
    gu: "વિભાગ પૂર્ણ થયો. આગલો વિભાગ શરૂ થાય છે.",
  },
  NAVIGATION_COMPLETE: {
    en: "Navigation complete. You have arrived at your destination.",
    hi: "नेविगेशन पूरा हुआ। आप अपने गंतव्य पर पहुंच गए हैं।",
    gu: "નેવિગેશન પૂર્ણ થયું. તમે તમારા ગંતવ્યે પહોંચી ગયા છો.",
  },
  ANALYZING_SURROUNDINGS: {
    en: "Analyzing surroundings.",
    hi: "आसपास का विश्लेषण किया जा रहा है।",
    gu: "આસપાસનું વિશ્લેષણ થઈ રહ્યું છે.",
  },
  ANALYSIS_UNAVAILABLE: {
    en: "Unable to analyze image. Proceed with caution.",
    hi: "छवि का विश्लेषण नहीं हो सका। सावधानी से आगे बढ़ें।",
    gu: "છબીનું વિશ્લેષણ શક્ય નથી. સાવધાનીથી આગળ વધો.",
  },
  ANALYSIS_FAILED: {
    en: "Analysis failed. Please try again.",
    hi: "विश्लेषण विफल रहा। कृपया फिर से प्रयास करें।",
    gu: "વિશ્લેષણ નિષ્ફળ ગયું. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
  CONTINUOUS_MONITORING_STARTED: {
    en: "Continuous monitoring started.",
    hi: "निरंतर निगरानी शुरू हो गई है।",
    gu: "સતત મોનિટરિંગ શરૂ થયું છે.",
  },
  CONTINUOUS_MONITORING_STOPPED: {
    en: "Continuous monitoring stopped.",
    hi: "निरंतर निगरानी बंद हो गई है।",
    gu: "સતત મોનિટરિંગ બંધ થયું છે.",
  },
  ANALYZE_ONCE_HINT: {
    en: "Analyze once. Takes a photo and analyzes obstacles.",
    hi: "एक बार विश्लेषण करें। यह फोटो लेकर बाधाओं का विश्लेषण करता है।",
    gu: "એક વખત એનાલાઇઝ કરો. આ ફોટો લઈ અવરોધોનું વિશ્લેષણ કરે છે.",
  },
  START_MONITORING_HINT: {
    en: "Start continuous monitoring.",
    hi: "निरंतर निगरानी शुरू करें।",
    gu: "સતત મોનિટરિંગ શરૂ કરો.",
  },
  STOP_MONITORING_HINT: {
    en: "Stop continuous monitoring.",
    hi: "निरंतर निगरानी बंद करें।",
    gu: "સતત મોનિટરિંગ બંધ કરો.",
  },
  SETTINGS_INTRO: {
    en: "Settings. Configure your preferences.",
    hi: "सेटिंग्स। अपनी पसंद कॉन्फ़िगर करें।",
    gu: "સેટિંગ્સ. તમારી પસંદગીઓ ગોઠવો.",
  },
  MODE_SWITCHED_ONLINE: {
    en: "Switched to online mode.",
    hi: "ऑनलाइन मोड पर स्विच किया गया।",
    gu: "ઑનલાઇન મોડ પર સ્વિચ કર્યું.",
  },
  MODE_SWITCHED_OFFLINE: {
    en: "Switched to offline mode.",
    hi: "ऑफ़लाइन मोड पर स्विच किया गया।",
    gu: "ઑફલાઇન મોડ પર સ્વિચ કર્યું.",
  },
  HAPTIC_ENABLED: {
    en: "Haptic feedback enabled.",
    hi: "हैप्टिक फीडबैक सक्षम किया गया।",
    gu: "હેપ્ટિક પ્રતિસાદ સક્રિય કર્યો.",
  },
  HAPTIC_DISABLED: {
    en: "Haptic feedback disabled.",
    hi: "हैप्टिक फीडबैक अक्षम किया गया।",
    gu: "હેપ્ટિક પ્રતિસાદ નિષ્ક્રિય કર્યો.",
  },
  VOICE_TEST_SAMPLE: {
    en: "This is a voice test. VisionMitra is ready.",
    hi: "यह एक वॉइस टेस्ट है। विज़नमित्र तैयार है।",
    gu: "આ અવાજ પરીક્ષણ છે. VisionMitra તૈયાર છે.",
  },
  HOW_TO_USE_GUIDE: {
    en: "VisionMitra is an AI-powered navigation assistant for visually impaired users. It provides real-time obstacle detection, voice guidance, emergency SOS, and helps find nearby transport stops.",
    hi: "VisionMitra दृष्टिबाधित उपयोगकर्ताओं के लिए एआई आधारित नेविगेशन सहायक है। यह रीयल-टाइम बाधा पहचान, वॉइस मार्गदर्शन, आपातकालीन एसओएस और पास के परिवहन स्टॉप खोजने में मदद करता है।",
    gu: "VisionMitra દ્રષ્ટિબાધિત વપરાશકર્તાઓ માટે AI આધારિત નેવિગેશન સહાયક છે. તે વાસ્તવિક સમય અવરોધ શોધ, અવાજ માર્ગદર્શન, ઇમરજન્સી SOS અને નજીકના ટ્રાન્સપોર્ટ સ્ટોપ શોધવામાં મદદ કરે છે.",
  },
  DETECTION_LOADING: {
    en: "Detection system loading. Proceed with caution.",
    hi: "डिटेक्शन सिस्टम लोड हो रहा है। सावधानी से आगे बढ़ें।",
    gu: "ડિટેક્શન સિસ્ટમ લોડ થઈ રહી છે. સાવધાનીથી આગળ વધો.",
  },
  DETECTION_SLOW: {
    en: "Detection is taking too long. Use caution ahead.",
    hi: "डिटेक्शन में अधिक समय लग रहा है। आगे सावधानी रखें।",
    gu: "ડિટેક્શનમાં વધુ સમય લાગી રહ્યો છે. આગળ સાવચેતી રાખો.",
  },
  DETECTION_ERROR_STOP: {
    en: "Detection error. Stop and reassess surroundings.",
    hi: "डिटेक्शन त्रुटि। रुकें और आसपास का आकलन करें।",
    gu: "ડિટેક્શન ભૂલ. રોકાઓ અને આસપાસનું પુનઃમૂલ્યાંકન કરો.",
  },
};
