// Command parser: spoken text -> VoiceCommand
// Matches lowercase transcripts against predefined command patterns

import type { VoiceCommand } from './types';

interface CommandPattern {
  pattern: RegExp;
  type: VoiceCommand['type'];
  extractParams?: (match: RegExpMatchArray) => VoiceCommand['params'];
}

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    pattern: /\bstart\s+detection\b/,
    type: 'start_detection',
  },
  {
    pattern: /\bstop\s+detection\b/,
    type: 'stop_detection',
  },
  {
    pattern: /\bnavigate\s+to\s+(.+)/,
    type: 'navigate_to',
    extractParams: (match) => ({ location: match[1].trim() }),
  },
  {
    pattern: /\bstop\s+navigation\b/,
    type: 'stop_navigation',
  },
  {
    pattern: /\bwhere\s+am\s+i\b/,
    type: 'where_am_i',
  },
  {
    pattern: /\bemergency\b/,
    type: 'emergency',
  },
];

export function parseCommand(rawText: string): VoiceCommand {
  const normalized = rawText.toLowerCase().trim();
  console.log(`[Voice] Parsing command: "${normalized}"`);

  for (const { pattern, type, extractParams } of COMMAND_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const cmd: VoiceCommand = {
        type,
        raw: rawText,
        params: extractParams?.(match),
      };
      console.log(`[Voice] Matched command: ${type}`, cmd.params ?? '');
      return cmd;
    }
  }

  console.log(`[Voice] No command matched for: "${normalized}"`);
  return { type: 'unknown', raw: rawText };
}
