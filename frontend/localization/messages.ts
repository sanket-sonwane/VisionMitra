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
  | "LANGUAGE_SET_GUJARATI"
  | "HOME_WELCOME"
  | "HOME_LIVE_NAV_LABEL"
  | "HOME_NAVIGATE_LABEL"
  | "HOME_EMERGENCY_LABEL"
  | "HOME_SETTINGS_LABEL"
  | "HOME_LIVE_NAV_DESC"
  | "HOME_NAVIGATE_DESC"
  | "HOME_EMERGENCY_DESC"
  | "HOME_SETTINGS_DESC"
  | "NAVIGATION_INTRO"
  | "VOICE_INPUT_FAILED"
  | "LOCATION_PERMISSION_REQUIRED"
  | "LOCATION_ACQUIRED"
  | "LOCATION_UNAVAILABLE"
  | "ENTER_DESTINATION"
  | "GETTING_LOCATION_FIRST"
  | "SEARCHING_DESTINATION"
  | "DESTINATION_NOT_FOUND"
  | "DESTINATION_FIND_FAILED"
  | "VOICE_INPUT_UNAVAILABLE_BUILD"
  | "MIC_PERMISSION_REQUIRED"
  | "VOICE_INPUT_UNAVAILABLE_DEVICE"
  | "LISTENING_FOR_DESTINATION"
  | "VOICE_INPUT_START_FAILED"
  | "CURRENT_LOCATION_NOT_AVAILABLE"
  | "COMPUTING_ROUTE"
  | "JOURNEY_PLAN_FAILED"
  | "JOURNEY_PLAN_NOT_AVAILABLE"
  | "NAVIGATION_START_FAILED"
  | "TAP_TO_STOP_LISTENING"
  | "TAP_TO_SPEAK_DESTINATION"
  | "EMERGENCY_INTRO"
  | "BACKEND_UNAVAILABLE_LOCAL_CONTACTS"
  | "ENTER_NAME_AND_PHONE"
  | "CONTACT_ADDED_SUCCESS"
  | "ADD_CONTACTS_FIRST"
  | "SOS_ACTIVATED"
  | "SOS_FLOW_FAILED"
  | "SOS_BUTTON_HINT"
  | "CANCEL_LABEL"
  | "ADD_NEW_CONTACT_LABEL"
  | "SETTINGS_MODE_TOGGLE_DESC"
  | "SETTINGS_HAPTIC_DESC"
  | "SETTINGS_VOICE_TEST_DESC"
  | "SETTINGS_HELP_DESCRIPTION";

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
  HOME_WELCOME: {
    en: "Welcome to VisionMitra. Your AI powered navigation assistant for safe mobility.",
    hi: "विजनमित्रा में आपका स्वागत है। सुरक्षित गतिशीलता के लिए आपका AI आधारित नेविगेशन सहायक।",
    gu: "વિઝનમિત્રામાં આપનું સ્વાગત છે. સુરક્ષિત ગતિશીલતા માટે તમારું AI આધારિત નેવિગેશન સહાયક.",
  },
  HOME_LIVE_NAV_LABEL: {
    en: "Live Navigation Camera",
    hi: "लाइव नेविगेशन कैमरा",
    gu: "લાઈવ નેવિગેશન કેમેરા",
  },
  HOME_NAVIGATE_LABEL: {
    en: "Navigation",
    hi: "नेविगेशन",
    gu: "નેવિગેશન",
  },
  HOME_EMERGENCY_LABEL: {
    en: "Emergency SOS",
    hi: "आपातकालीन SOS",
    gu: "આપાતકાલીન SOS",
  },
  HOME_SETTINGS_LABEL: {
    en: "Settings",
    hi: "सेटिंग्स",
    gu: "સેટિંગ્સ",
  },
  HOME_LIVE_NAV_DESC: {
    en: "Live Navigation Camera. Opens real-time obstacle detection.",
    hi: "लाइव नेविगेशन कैमरा। रियल-टाइम बाधा पहचान खोलता है।",
    gu: "લાઈવ નેવિગેશન કેમેરા. રિયલ-ટાઈમ અવરોધ શોધ શરૂ કરે છે.",
  },
  HOME_NAVIGATE_DESC: {
    en: "Navigation. Plan route to destination.",
    hi: "नेविगेशन। गंतव्य तक मार्ग की योजना बनाएं।",
    gu: "નેવિગેશન. ગંતવ્ય સુધીનો માર્ગ બનાવો.",
  },
  HOME_EMERGENCY_DESC: {
    en: "Emergency SOS. Quick access to emergency contacts.",
    hi: "आपातकालीन SOS। आपातकालीन संपर्कों तक त्वरित पहुंच।",
    gu: "આપાતકાલીન SOS. આપાતકાલીન સંપર્કો સુધી ઝડપી પહોંચ.",
  },
  HOME_SETTINGS_DESC: {
    en: "Settings. Configure app preferences and profile.",
    hi: "सेटिंग्स। ऐप प्राथमिकताएँ और प्रोफ़ाइल कॉन्फ़िगर करें।",
    gu: "સેટિંગ્સ. એપ પસંદગીઓ અને પ્રોફાઇલ ગોઠવો.",
  },
  NAVIGATION_INTRO: {
    en: "Navigation. Enter destination or select nearby transport stops.",
    hi: "नेविगेशन। गंतव्य दर्ज करें या पास के परिवहन स्टॉप चुनें।",
    gu: "નેવિગેશન. ગંતવ્ય દાખલ કરો અથવા નજીકના પરિવહન સ્ટોપ પસંદ કરો.",
  },
  VOICE_INPUT_FAILED: {
    en: "Voice input failed. Please try again.",
    hi: "वॉइस इनपुट विफल हुआ। कृपया फिर से प्रयास करें।",
    gu: "વોઇસ ઇનપુટ નિષ્ફળ ગયું. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
  LOCATION_PERMISSION_REQUIRED: {
    en: "Location permission required for navigation.",
    hi: "नेविगेशन के लिए लोकेशन अनुमति आवश्यक है।",
    gu: "નેવિગેશન માટે સ્થાન પરવાનગી જરૂરી છે.",
  },
  LOCATION_ACQUIRED: {
    en: "Location acquired.",
    hi: "लोकेशन प्राप्त हुई।",
    gu: "સ્થાન પ્રાપ્ત થયું.",
  },
  LOCATION_UNAVAILABLE: {
    en: "Unable to get current location.",
    hi: "वर्तमान लोकेशन प्राप्त नहीं हो सकी।",
    gu: "વર્તમાન સ્થાન મેળવી શકાયું નથી.",
  },
  ENTER_DESTINATION: {
    en: "Please enter a destination.",
    hi: "कृपया एक गंतव्य दर्ज करें।",
    gu: "કૃપા કરીને ગંતવ્ય દાખલ કરો.",
  },
  GETTING_LOCATION_FIRST: {
    en: "Getting your location first.",
    hi: "पहले आपकी लोकेशन प्राप्त की जा रही है।",
    gu: "પહેલાં તમારું સ્થાન મેળવી રહ્યા છીએ.",
  },
  SEARCHING_DESTINATION: {
    en: "Searching for destination.",
    hi: "गंतव्य खोजा जा रहा है।",
    gu: "ગંતવ્ય શોધી રહ્યા છીએ.",
  },
  DESTINATION_NOT_FOUND: {
    en: "Destination not found. Please try a different search.",
    hi: "गंतव्य नहीं मिला। कृपया अलग खोज का प्रयास करें।",
    gu: "ગંતવ્ય મળ્યું નથી. કૃપા કરીને બીજી શોધ અજમાવો.",
  },
  DESTINATION_FIND_FAILED: {
    en: "Unable to find destination. Please try again.",
    hi: "गंतव्य नहीं मिल पाया। कृपया फिर से प्रयास करें।",
    gu: "ગંતવ્ય મળી શક્યું નથી. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
  VOICE_INPUT_UNAVAILABLE_BUILD: {
    en: "Voice input is unavailable in this app build.",
    hi: "इस ऐप बिल्ड में वॉइस इनपुट उपलब्ध नहीं है।",
    gu: "આ એપ બિલ્ડમાં વોઇસ ઇનપુટ ઉપલબ્ધ નથી.",
  },
  MIC_PERMISSION_REQUIRED: {
    en: "Microphone permission is required for voice destination input.",
    hi: "वॉइस गंतव्य इनपुट के लिए माइक्रोफोन अनुमति आवश्यक है।",
    gu: "વોઇસ ગંતવ્ય ઇનપુટ માટે માઇક્રોફોન પરવાનગી જરૂરી છે.",
  },
  VOICE_INPUT_UNAVAILABLE_DEVICE: {
    en: "Voice input is not available on this device.",
    hi: "इस डिवाइस पर वॉइस इनपुट उपलब्ध नहीं है।",
    gu: "આ ઉપકરણ પર વોઇસ ઇનપુટ ઉપલબ્ધ નથી.",
  },
  LISTENING_FOR_DESTINATION: {
    en: "Listening. Please say your destination.",
    hi: "सुन रहा हूँ। कृपया अपना गंतव्य बोलें।",
    gu: "સાંભળી રહ્યા છીએ. કૃપા કરીને તમારું ગંતવ્ય બોલો.",
  },
  VOICE_INPUT_START_FAILED: {
    en: "Unable to start voice input.",
    hi: "वॉइस इनपुट शुरू नहीं हो सका।",
    gu: "વોઇસ ઇનપુટ શરૂ કરી શકાયું નથી.",
  },
  CURRENT_LOCATION_NOT_AVAILABLE: {
    en: "Current location not available.",
    hi: "वर्तमान लोकेशन उपलब्ध नहीं है।",
    gu: "વર્તમાન સ્થાન ઉપલબ્ધ નથી.",
  },
  COMPUTING_ROUTE: {
    en: "Computing optimal route.",
    hi: "सर्वोत्तम मार्ग की गणना की जा रही है।",
    gu: "શ્રેષ્ઠ માર્ગની ગણતરી કરી રહ્યા છીએ.",
  },
  JOURNEY_PLAN_FAILED: {
    en: "Unable to plan journey. Please try again.",
    hi: "यात्रा योजना नहीं बन सकी। कृपया फिर से प्रयास करें।",
    gu: "મુસાફરીની યોજના બની નથી. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
  JOURNEY_PLAN_NOT_AVAILABLE: {
    en: "Journey plan not available.",
    hi: "यात्रा योजना उपलब्ध नहीं है।",
    gu: "મુસાફરીની યોજના ઉપલબ્ધ નથી.",
  },
  NAVIGATION_START_FAILED: {
    en: "Failed to start navigation. Please try again.",
    hi: "नेविगेशन शुरू नहीं हो सका। कृपया फिर से प्रयास करें।",
    gu: "નેવિગેશન શરૂ થઈ શક્યું નથી. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
  TAP_TO_STOP_LISTENING: {
    en: "Tap to stop listening.",
    hi: "सुनना बंद करने के लिए टैप करें।",
    gu: "સાંભળવું બંધ કરવા ટેપ કરો.",
  },
  TAP_TO_SPEAK_DESTINATION: {
    en: "Tap to speak your destination.",
    hi: "अपना गंतव्य बोलने के लिए टैप करें।",
    gu: "તમારું ગંતવ્ય બોલવા ટેપ કરો.",
  },
  EMERGENCY_INTRO: {
    en: "Emergency contacts. Add contacts for SOS alerts.",
    hi: "आपातकालीन संपर्क। SOS अलर्ट के लिए संपर्क जोड़ें।",
    gu: "આપાતકાલીન સંપર્કો. SOS એલર્ટ માટે સંપર્ક ઉમેરો.",
  },
  BACKEND_UNAVAILABLE_LOCAL_CONTACTS: {
    en: "Backend unavailable. You can still add contacts locally.",
    hi: "बैकएंड उपलब्ध नहीं है। आप फिर भी स्थानीय रूप से संपर्क जोड़ सकते हैं।",
    gu: "બેકએન્ડ ઉપલબ્ધ નથી. તમે હજુપણ સ્થાનિક રીતે સંપર્ક ઉમેરી શકો છો.",
  },
  ENTER_NAME_AND_PHONE: {
    en: "Please enter name and phone number.",
    hi: "कृपया नाम और फोन नंबर दर्ज करें।",
    gu: "કૃપા કરીને નામ અને ફોન નંબર દાખલ કરો.",
  },
  CONTACT_ADDED_SUCCESS: {
    en: "Contact added successfully.",
    hi: "संपर्क सफलतापूर्वक जोड़ा गया।",
    gu: "સંપર્ક સફળતાપૂર્વક ઉમેરાયો.",
  },
  ADD_CONTACTS_FIRST: {
    en: "Add emergency contacts first.",
    hi: "पहले आपातकालीन संपर्क जोड़ें।",
    gu: "પહેલાં આપાતકાલીન સંપર્કો ઉમેરો.",
  },
  SOS_ACTIVATED: {
    en: "SOS activated. Getting your location and notifying contacts.",
    hi: "SOS सक्रिय हुआ। आपकी लोकेशन लेकर संपर्कों को सूचित किया जा रहा है।",
    gu: "SOS સક્રિય થયું. તમારું સ્થાન મેળવી સંપર્કોને જાણ કરી રહ્યા છીએ.",
  },
  SOS_FLOW_FAILED: {
    en: "Failed to complete SOS flow. Please call emergency contact manually.",
    hi: "SOS प्रक्रिया पूरी नहीं हो सकी। कृपया आपातकालीन संपर्क को मैन्युअली कॉल करें।",
    gu: "SOS પ્રક્રિયા પૂર્ણ થઈ નથી. કૃપા કરીને આપાતકાલીન સંપર્કને હાથેથી કૉલ કરો.",
  },
  SOS_BUTTON_HINT: {
    en: "Emergency SOS button. Press to alert all emergency contacts with your location.",
    hi: "आपातकालीन SOS बटन। अपनी लोकेशन के साथ सभी आपातकालीन संपर्कों को अलर्ट करने के लिए दबाएँ।",
    gu: "આપાતકાલીન SOS બટન. તમારા સ્થાન સાથે બધા આપાતકાલીન સંપર્કોને એલર્ટ કરવા દબાવો.",
  },
  CANCEL_LABEL: {
    en: "Cancel",
    hi: "रद्द करें",
    gu: "રદ કરો",
  },
  ADD_NEW_CONTACT_LABEL: {
    en: "Add new contact",
    hi: "नया संपर्क जोड़ें",
    gu: "નવો સંપર્ક ઉમેરો",
  },
  SETTINGS_MODE_TOGGLE_DESC: {
    en: "Toggle between online and offline mode. Online mode uses AI for accurate detection. Offline mode uses basic detection and works without internet.",
    hi: "ऑनलाइन और ऑफलाइन मोड के बीच बदलें। ऑनलाइन मोड सटीक पहचान के लिए AI का उपयोग करता है। ऑफलाइन मोड बुनियादी पहचान का उपयोग करता है और इंटरनेट के बिना काम करता है।",
    gu: "ઓનલાઇન અને ઓફલાઇન મોડ વચ્ચે બદલો. ઓનલાઈન મોડ ચોક્કસ શોધ માટે AI નો ઉપયોગ કરે છે. ઓફલાઇન મોડ મૂળભૂત શોધનો ઉપયોગ કરે છે અને ઇન્ટરનેટ વગર કામ કરે છે.",
  },
  SETTINGS_HAPTIC_DESC: {
    en: "Toggle haptic feedback. Provides vibration alerts for actions and warnings.",
    hi: "हैप्टिक फीडबैक टॉगल करें। यह क्रियाओं और चेतावनियों के लिए कंपन अलर्ट देता है।",
    gu: "હેપ્ટિક ફીડબેક ટૉગલ કરો. તે ક્રિયાઓ અને ચેતવણીઓ માટે કંપન એલર્ટ આપે છે.",
  },
  SETTINGS_VOICE_TEST_DESC: {
    en: "Test voice output. Press to hear a sample message.",
    hi: "वॉइस आउटपुट जांचें। नमूना संदेश सुनने के लिए दबाएँ।",
    gu: "વોઇસ આઉટપુટ ચકાસો. નમૂના સંદેશ માટે દબાવો.",
  },
  SETTINGS_HELP_DESCRIPTION: {
    en: "Eye Guide is an AI-powered navigation assistant for visually impaired users. It provides real-time obstacle detection, voice guidance, emergency SOS, and helps find nearby transport stops. Use online mode for accurate AI detection or offline mode for basic navigation.",
    hi: "आई गाइड दृष्टिबाधित उपयोगकर्ताओं के लिए AI आधारित नेविगेशन सहायक है। यह रियल-टाइम बाधा पहचान, वॉइस मार्गदर्शन, आपातकालीन SOS और पास के परिवहन स्टॉप खोजने में मदद देता है। सटीक AI पहचान के लिए ऑनलाइन मोड या बुनियादी नेविगेशन के लिए ऑफलाइन मोड उपयोग करें।",
    gu: "આઈ ગાઇડ દૃષ્ટિબાધિત વપરાશકર્તાઓ માટે AI આધારિત નેવિગેશન સહાયક છે. તે રિયલ-ટાઈમ અવરોધ શોધ, અવાજ માર્ગદર્શન, આપાતકાલીન SOS અને નજીકના પરિવહન સ્ટોપ શોધવામાં મદદ કરે છે. ચોક્કસ AI શોધ માટે ઓનલાઈન મોડ અથવા મૂળભૂત નેવિગેશન માટે ઓફલાઇન મોડ વાપરો.",
  },
};
