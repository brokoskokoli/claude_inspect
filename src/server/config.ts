import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

export const paths = {
  projects: join(CLAUDE_DIR, 'projects'),
  sessions: join(CLAUDE_DIR, 'sessions'),
  jobs: join(CLAUDE_DIR, 'jobs'),
  daemonRoster: join(CLAUDE_DIR, 'daemon', 'roster.json'),
  tasks: join(CLAUDE_DIR, 'tasks'),
  history: join(CLAUDE_DIR, 'history.jsonl'),
};

/**
 * Dateien mit Zugangsdaten. Werden nie gelesen – auch nicht über die Rohansicht.
 * Pfade relativ zu CLAUDE_DIR, mit "/" als Trenner.
 */
const DENY: RegExp[] = [
  /\.key$/,
  /^daemon\/(control\.key|auth\/)/,
  /^ide\//,
  /credentials/i,
  /^session-env\//,
  /^shell-snapshots\//,
];

export function relToClaude(abs: string): string {
  return relative(CLAUDE_DIR, abs).split(sep).join('/');
}

export function isDenied(abs: string): boolean {
  const rel = relToClaude(abs);
  if (rel.startsWith('..')) return true;
  return DENY.some((r) => r.test(rel));
}

/** Limits für die Datenmenge, die ans Frontend geht. */
export const LIMITS = {
  /** Maximale Länge eines Strings in Einträgen, bevor gekürzt wird. */
  maxString: 24_000,
  /** Arbeitsspeicher-Budget für geladene Transcripts (Bytes der Quelldateien). */
  transcriptCacheBytes: 400 * 1024 * 1024,
  /** Rohansicht einer Zeile. */
  maxRawLine: 4 * 1024 * 1024,
};
