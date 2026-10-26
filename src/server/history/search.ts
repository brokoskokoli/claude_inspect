import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { SearchHit, SearchResult } from '../../shared/types.js';
import { paths } from '../config.js';
import { registry } from '../formats/index.js';
import type { HistoryPrompt } from '../formats/history/prompt.js';
import { pathTail } from '../sources/projects.js';
import { normalize, type SearchIndex } from './search-index.js';
import { queryTrigrams } from './trigrams.js';

export interface SearchFile {
  path: string;
  sessionId: string;
  agentId?: string;
  project: string;
  title?: string;
  /** Namen dieser Session bzw. dieses Subagenten, nach denen gesucht werden kann */
  names?: string[];
}

const home = homedir();
const tildify = (p: string) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p);

function snippet(text: string, needle: string, radius = 90): string {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/**
 * Volltextsuche über den Suchindex – immer über alle Transcripts, ohne Zeitlimit. Groß- und
 * Kleinschreibung sowie Art und Anzahl von Leerzeichen und Zeilenumbrüchen spielen keine Rolle.
 * Dazu Treffer in Session- und Agent-Namen und in Dateinamen. Neueste Dateien zuerst; ab `limit`
 * Treffern wird nur noch gezählt, in wie vielen weiteren Dateien etwas steht.
 */
export async function search(query: string, files: SearchFile[], knownSessions: Set<string>, index: SearchIndex, limit = 500, perFile = 5): Promise<Omit<SearchResult, 'agents'>> {
  const t0 = Date.now();
  const needle = normalize(query).toLowerCase();
  const hits: SearchHit[] = [];
  let scanned = 0;
  let moreFiles = 0;
  const indexing = index.ready ? undefined : { ...index.progress };
  if (needle.length < 2) return { query, hits, scannedFiles: 0, totalFiles: files.length, truncated: false, ms: 0 };

  // Namen von Sessions und Agenten (eigener Titel, Agent-Name, KI-Titel, Prozessname, Subagent-Beschreibung)
  for (const f of files) {
    for (const name of new Set(f.names)) {
      if (!normalize(name).toLowerCase().includes(needle)) continue;
      hits.push({ sessionId: f.sessionId, agentId: f.agentId, project: f.project, title: f.title, line: 0, kind: 'name', snippet: name });
    }
  }

  // Dateinamen und Pfade der Transcripts (z. B. "agent-a1b2….jsonl", Session-Id, Pfadteile)
  const pathNeedle = (needle.startsWith('~') && home ? home.toLowerCase() + needle.slice(1) : needle).replace(/\\/g, '/');
  let fileHits = 0;
  for (const f of files) {
    const p = f.path.replace(/\\/g, '/');
    if (!p.toLowerCase().includes(pathNeedle)) continue;
    hits.push({ sessionId: f.sessionId, agentId: f.agentId, project: f.project, title: f.title, line: 0, kind: 'file', snippet: tildify(f.path) });
    if (++fileHits >= 50) break;
  }

  const trigrams = queryTrigrams(needle);
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  for (const f of files) {
    const found = await index.search(f.path, re, hits.length < limit ? perFile : 1, trigrams);
    scanned++;
    if (!found.length) continue;
    if (hits.length >= limit) {
      moreFiles++;
      continue;
    }
    for (const h of found) hits.push({ sessionId: f.sessionId, agentId: f.agentId, project: f.project, title: f.title, ...h });
  }

  // Prompts aus history.jsonl, deren Session-Transcript nicht mehr existiert
  if (hits.length < limit) {
    try {
      const lines = (await readFile(paths.history, 'utf8')).split('\n');
      for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
        if (!lines[i]) continue;
        try {
          const p = registry.decode<HistoryPrompt>('history', JSON.parse(lines[i]), paths.history, i, { silent: true }).out;
          if (!normalize(p.display).toLowerCase().includes(needle) || (p.sessionId && knownSessions.has(p.sessionId))) continue;
          hits.push({
            sessionId: p.sessionId ?? '',
            project: p.project ? pathTail(p.project) : '?',
            title: 'transcript no longer exists',
            line: i,
            kind: 'history-prompt',
            ts: p.timestamp ? new Date(p.timestamp).toISOString() : undefined,
            snippet: snippet(normalize(p.display), needle),
          });
        } catch {
          /* defekte Zeile */
        }
      }
    } catch {
      /* keine history.jsonl */
    }
  }
  return { query, hits, scannedFiles: scanned, totalFiles: files.length, truncated: moreFiles > 0, moreFiles, indexing, ms: Date.now() - t0 };
}
