import { readFile } from 'node:fs/promises';
import type { Entry, SearchHit, SearchResult } from '../../shared/types.js';
import { toolSummary } from '../../shared/tools.js';
import { paths } from '../config.js';
import { registry } from '../formats/index.js';
import type { HistoryPrompt } from '../formats/history/prompt.js';
import type { DecodedEntry } from '../formats/transcript/common.js';

export interface SearchFile {
  path: string;
  sessionId: string;
  agentId?: string;
  project: string;
  title?: string;
}

function snippet(text: string, needle: string, radius = 90): string {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

/** Durchsuchbarer Text eines Eintrags – Anhänge und Zustands-Records bewusst nicht. */
function searchable(e: Entry): string | undefined {
  switch (e.kind) {
    case 'user-text':
    case 'assistant-text':
    case 'thinking':
      return e.text;
    case 'tool-use':
      return `${toolSummary(e.name, e.input)}\n${JSON.stringify(e.input)}`;
    case 'tool-result':
      return e.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    case 'system':
      return e.text;
    default:
      return undefined;
  }
}

/**
 * Volltextsuche direkt über die JSONL-Dateien (kein Index): Rohtext wird
 * nach dem Suchbegriff durchsucht, nur Trefferzeilen werden dekodiert.
 * Neueste Dateien zuerst; bricht bei `limit` Treffern oder nach `budgetMs` ab.
 */
export async function search(query: string, files: SearchFile[], knownSessions: Set<string>, limit = 200, budgetMs = 6000, perFile = 5): Promise<SearchResult> {
  const t0 = Date.now();
  const needle = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  let scanned = 0;
  let truncated = false;
  if (needle.length < 2) return { query, hits, scannedFiles: 0, totalFiles: files.length, truncated, ms: 0 };

  outer: for (const f of files) {
    if (Date.now() - t0 > budgetMs) {
      truncated = true;
      break;
    }
    let text: string;
    try {
      text = await readFile(f.path, 'utf8');
    } catch {
      continue;
    }
    scanned++;
    const lower = text.toLowerCase();
    let pos = lower.indexOf(needle);
    let lineNo = 0;
    let counted = 0;
    let lastLine = -1;
    let inFile = 0;
    while (pos !== -1 && inFile < perFile) {
      for (let i = text.indexOf('\n', counted); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) {
        lineNo++;
        counted = i + 1;
      }
      const lineStart = counted;
      const lineEnd = text.indexOf('\n', pos);
      if (lineNo !== lastLine) {
        lastLine = lineNo;
        try {
          const raw = JSON.parse(text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd));
          const { out } = registry.decode<DecodedEntry[]>('transcript', raw, f.path, lineNo, { silent: true });
          for (const e of out as Entry[]) {
            const s = searchable(e);
            if (!s || !s.toLowerCase().includes(needle)) continue;
            hits.push({
              sessionId: f.sessionId,
              agentId: f.agentId,
              project: f.project,
              title: f.title,
              line: lineNo,
              kind: e.kind,
              toolName: e.kind === 'tool-use' ? e.name : undefined,
              toolUseId: e.kind === 'tool-use' || e.kind === 'tool-result' ? e.toolUseId : undefined,
              ts: e.timestamp,
              snippet: snippet(s, needle),
            });
            inFile++;
            break;
          }
        } catch {
          /* defekte Zeile */
        }
        if (hits.length >= limit) {
          truncated = true;
          break outer;
        }
      }
      if (lineEnd === -1) break;
      pos = lower.indexOf(needle, lineEnd);
    }
  }

  // Prompts aus history.jsonl, deren Session-Transcript nicht mehr existiert
  if (hits.length < limit) {
    try {
      const lines = (await readFile(paths.history, 'utf8')).split('\n');
      for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        try {
          const p = registry.decode<HistoryPrompt>('history', JSON.parse(lines[i]), paths.history, i, { silent: true }).out;
          if (!p.display.toLowerCase().includes(needle) || (p.sessionId && knownSessions.has(p.sessionId))) continue;
          hits.push({
            sessionId: p.sessionId ?? '',
            project: p.project?.split('/').pop() ?? '?',
            title: 'transcript no longer exists',
            line: i,
            kind: 'history-prompt',
            ts: p.timestamp ? new Date(p.timestamp).toISOString() : undefined,
            snippet: snippet(p.display, needle),
          });
        } catch {
          /* defekte Zeile */
        }
      }
    } catch {
      /* keine history.jsonl */
    }
  }
  return { query, hits, scannedFiles: scanned, totalFiles: files.length, truncated, ms: Date.now() - t0 };
}
