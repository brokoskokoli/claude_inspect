import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { SearchHit, SearchResult } from '../../shared/types.js';
import { paths } from '../config.js';
import { registry } from '../formats/index.js';
import type { HistoryPrompt } from '../formats/history/prompt.js';
import { pathTail } from '../sources/projects.js';
import { normalize, type SearchIndex } from './search-index.js';
import { fragments, matchText, parseQuery, score, tightest, tooShort } from '../../shared/search-query.js';
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

/**
 * Volltextsuche über den Suchindex – immer über alle Transcripts, ohne Zeitlimit. Groß- und
 * Kleinschreibung sowie Art und Anzahl von Leerzeichen und Zeilenumbrüchen spielen keine Rolle.
 * Mehrere Wörter im selben Eintrag, "…" als Phrase, `~N` für N aufeinanderfolgende Einträge, ab
 * drei Begriffen auch Teiltreffer (siehe shared/search-query.ts). Dazu Treffer in Session- und
 * Agent-Namen, in Dateinamen und in der Prompt-Historie. Alle Treffer werden gesammelt und nach
 * `score` sortiert (bei Gleichstand neueste zuerst); die besten `limit` kommen zurück.
 */
export async function search(query: string, files: SearchFile[], knownSessions: Set<string>, index: SearchIndex, limit = 500, perFile = 5): Promise<Omit<SearchResult, 'agents'>> {
  const t0 = Date.now();
  const q = parseQuery(query);
  let hits: SearchHit[] = [];
  let scanned = 0;
  const indexing = index.ready ? undefined : { ...index.progress };
  if (tooShort(q)) return { query, hits, scannedFiles: 0, totalFiles: files.length, truncated: false, ms: 0 };
  const facts = (m: NonNullable<ReturnType<typeof matchText>>) => ({ matched: m.matched, span: 1, occurrences: m.occurrences, phrase: m.phrase, gap: m.gap });

  // Namen von Sessions und Agenten (eigener Titel, Agent-Name, KI-Titel, Prozessname, Subagent-Beschreibung)
  for (const f of files) {
    for (const name of new Set(f.names)) {
      const m = matchText(normalize(name).toLowerCase(), q);
      if (!m) continue;
      hits.push({ sessionId: f.sessionId, agentId: f.agentId, project: f.project, title: f.title, line: 0, kind: 'name', snippet: name, matched: m.matched, score: score(q, facts(m), 'name') });
    }
  }

  // Dateinamen und Pfade der Transcripts (z. B. "agent-a1b2….jsonl", Session-Id, Pfadteile)
  const pathQuery = { ...q, terms: q.terms.map((t) => (t.startsWith('~') && home ? home.toLowerCase() + t.slice(1) : t).replace(/\\/g, '/')) };
  pathQuery.literal = pathQuery.terms.join(' ');
  let fileHits = 0;
  for (const f of files) {
    const m = matchText(f.path.replace(/\\/g, '/').toLowerCase(), pathQuery);
    if (!m) continue;
    hits.push({ sessionId: f.sessionId, agentId: f.agentId, project: f.project, title: f.title, line: 0, kind: 'file', snippet: tildify(f.path), matched: m.matched, score: score(q, facts(m), 'file') });
    if (++fileHits >= 50) break;
  }

  const trigrams = q.terms.map(queryTrigrams);
  for (const f of files) {
    const found = await index.search(f.path, q, perFile, trigrams);
    scanned++;
    for (const h of found) hits.push({ sessionId: f.sessionId, agentId: f.agentId, project: f.project, title: f.title, ...h });
  }

  // Prompts aus history.jsonl, deren Session-Transcript nicht mehr existiert
  try {
    const lines = (await readFile(paths.history, 'utf8')).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      try {
        const p = registry.decode<HistoryPrompt>('history', JSON.parse(lines[i]), paths.history, i, { silent: true }).out;
        if (p.sessionId && knownSessions.has(p.sessionId)) continue;
        const text = normalize(p.display);
        const m = matchText(text.toLowerCase(), q);
        if (!m) continue;
        const tight = m.matched > 1 ? tightest(m.pos) : undefined;
        hits.push({
          sessionId: p.sessionId ?? '',
          project: p.project ? pathTail(p.project) : '?',
          title: 'transcript no longer exists',
          line: i,
          kind: 'history-prompt',
          ts: p.timestamp ? new Date(p.timestamp).toISOString() : undefined,
          snippet: fragments(text, tight && tight.end - tight.start <= 240 ? [{ at: tight.start, len: tight.end - tight.start }] : [...new Map(m.pos.map((x) => [x.t, x])).values()]),
          matched: m.matched,
          score: score(q, facts(m), 'text'),
        });
      } catch {
        /* defekte Zeile */
      }
    }
  } catch {
    /* keine history.jsonl */
  }

  hits.sort((a, b) => b.score - a.score || (b.ts ?? '').localeCompare(a.ts ?? ''));
  const key = (h: SearchHit) => `${h.kind === 'history-prompt' ? 'h' : ''}${h.sessionId}/${h.agentId ?? ''}`;
  const all = new Set(hits.map(key));
  hits = hits.slice(0, limit);
  const shown = new Set(hits.map(key));
  const moreFiles = all.size - shown.size;
  return { query, hits, terms: q.terms.length, scannedFiles: scanned, totalFiles: files.length, truncated: moreFiles > 0, moreFiles, indexing, ms: Date.now() - t0 };
}
