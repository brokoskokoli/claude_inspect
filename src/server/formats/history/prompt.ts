import type { Decoder } from '../types.js';
import { num, str } from '../util.js';

export interface HistoryPrompt {
  display: string;
  timestamp?: number;
  project?: string;
  sessionId?: string;
}

/** ~/.claude/history.jsonl – jede Nutzereingabe über alle Projekte. */
export const historyPromptDecoder: Decoder<HistoryPrompt> = {
  id: 'history.prompt@1',
  source: 'history',
  description: 'prompt history (prompt, project, session, time)',
  match: (raw) => (typeof raw.display === 'string' ? 10 : 0),
  decode: (raw) => ({ display: str(raw.display) ?? '', timestamp: num(raw.timestamp), project: str(raw.project), sessionId: str(raw.sessionId) }),
  knownFields: () => ['display', 'timestamp', 'project', 'sessionId', 'pastedContents'],
};

export const historyFallback: Decoder<HistoryPrompt> = {
  id: 'history.fallback',
  source: 'history',
  description: 'unknown history entry',
  match: () => 1,
  decode: (raw) => ({ display: JSON.stringify(raw).slice(0, 200) }),
};
