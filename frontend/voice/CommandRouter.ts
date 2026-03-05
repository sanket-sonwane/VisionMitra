// Command router: dispatches parsed VoiceCommands to app module callbacks

import type { VoiceCommand, VoiceEngineCallbacks } from './types';

export function routeCommand(
  command: VoiceCommand,
  callbacks: VoiceEngineCallbacks
): boolean {
  console.log(`[Voice] Routing command: ${command.type}`);

  switch (command.type) {
    case 'start_detection':
      console.log('[Voice] -> startDetection() -> /camera');
      callbacks.startDetection();
      return true;

    case 'stop_detection':
      console.log('[Voice] -> stopDetection() -> /');
      callbacks.stopDetection();
      return true;

    case 'navigate_to': {
      const location = command.params?.location;
      if (location) {
        console.log(`[Voice] -> startNavigation("${location}") -> /navigate?dest=${location}`);
        callbacks.startNavigation(location);
        return true;
      }
      console.log('[Voice] -> navigate_to with no location — unhandled');
      return false;
    }

    case 'stop_navigation':
      console.log('[Voice] -> stopNavigation() -> /');
      callbacks.stopNavigation();
      return true;

    case 'where_am_i':
      console.log('[Voice] -> speakCurrentLocation()');
      callbacks.speakCurrentLocation();
      return true;

    case 'emergency':
      console.log('[Voice] -> triggerSOS() -> /emergency');
      callbacks.triggerSOS();
      return true;

    default:
      console.log(`[Voice] -> unrecognized command type: ${command.type}`);
      return false;
  }
}
