import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Entry } from '../../shared/types.js';
import { toolSummary } from '../../shared/tools.js';
import { registry } from '../formats/index.js';
import type { DecodedEntry } from '../formats/transcript/common.js';
import { JsonlTail } from '../util/jsonl.js';
import { fragments, score, tightest, type MatchFacts, type Pos, type SearchQuery } from '../../shared/search-query.js';
import { Trigrams } from './trigrams.js';

/**
 * Suchindex über den Text aller Transcripts: Prompts, Antworten, Thinking, Tool-Aufrufe und
 * -Ergebnisse – ungekürzt, ohne JSON-Escapes und mit zusammengefassten Leerzeichen, so wie man
 * ihn aus der Oberfläche kopiert. Je Transcript eine Textdatei im Datenverzeichnis, die nur um
 * neue Zeilen wächst; der Stand (Byte-Offset je Transcript) überlebt Neustarts. Eine Suche liest
 * jede Indexdatei, in der der Begriff stehen kann, ohne Zeitlimit; welche das sind, sagt je Datei
 * ein Bitfeld der vorkommenden Dreierfolgen von Zeichen (siehe trigrams.ts, Datei `<id>.tri`).
 *
 * Aufbau einer Indexdatei (`<id>.txt`): je Eintrag RS + JSON-Metadaten + US + Text.
 */

/** Erhöhen, wenn sich der Inhalt des Index ändert – dann wird er neu aufgebaut. */
const VERSION = 1;
const RS = '\u001e';
const US = '\u001f';
const CHUNK_BYTES = 4 * 1024 * 1024;
const SAVE_EVERY_MS = 10_000;

interface Segment {
  id: string;
  /** gelesene Bytes des Transcripts (bis zur letzten vollständigen Zeile) */
  offset: number;
  line: number;
  /** Größe der Indexdatei zu diesem Stand */
  bytes: number;
}

type Meta = [line: number, kind: string, ts: string | null, toolName: string | null, toolUseId: string | null];

export interface IndexedHit {
  line: number;
  kind: string;
  ts?: string;
  toolName?: string;
  toolUseId?: string;
  snippet: string;
  /** Treffer über mehrere Einträge (Suche mit ~N): so viele, ab diesem */
  span?: number;
  /** wie viele Begriffe der Anfrage getroffen sind */
  matched: number;
  score: number;
}

/** Leerzeichen, Zeilenumbrüche und Tabs zu einem Leerzeichen; Trennzeichen des Index entfernen. */
export function normalize(s: string): string {
  return s.replace(/[\s\u001e\u001f]+/g, ' ').trim();
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** Durchsuchbarer Text eines Eintrags – Anhänge und Zustands-Records bewusst nicht. */
export function searchable(e: Entry): string | undefined {
  switch (e.kind) {
    case 'user-text':
    case 'assistant-text':
    case 'thinking':
    case 'system':
      return e.text;
    case 'tool-use': {
      const values = strings(e.input);
      const summary = toolSummary(e.name, e.input);
      return (values.includes(summary) ? values : [summary, ...values]).join('\n');
    }
    case 'tool-result':
      return e.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    default:
      return undefined;
  }
}

export class SearchIndex {
  private segments = new Map<string, Segment>();
  /** Dreierfolgen je Transcript; `triDirty` noch nicht gespeichert */
  private tri = new Map<string, Trigrams>();
  private triDirty = new Set<string>();
  private loaded?: Promise<void>;
  private running?: Promise<void>;
  private next?: { paths: string[]; full: boolean };
  private savedAt = 0;
  /** Erster vollständiger Durchlauf fertig */
  ready = false;
  progress = { files: 0, total: 0 };

  constructor(readonly dir: string) {}

  private get manifest(): string {
    return join(this.dir, 'manifest.json');
  }

  private segPath(s: Segment): string {
    return join(this.dir, `${s.id}.txt`);
  }

  private triPath(s: Segment): string {
    return join(this.dir, `${s.id}.tri`);
  }

  /** Bitfeld der Dreierfolgen aus der Indexdatei neu berechnen (fehlt, oder zu voll geworden). */
  private async rebuildTrigrams(path: string, s: Segment, t = new Trigrams()): Promise<void> {
    let text = '';
    try {
      text = await readFile(this.segPath(s), 'utf8');
    } catch {
      /* noch leer */
    }
    for (;;) {
      for (let i = text.indexOf(RS); i !== -1; ) {
        const sep = text.indexOf(US, i);
        const next = text.indexOf(RS, i + 1);
        if (sep !== -1 && (next === -1 || sep < next)) t.add(text.slice(sep + 1, next === -1 ? undefined : next));
        i = next;
      }
      if (!t.full) break;
      t = t.grown();
    }
    this.tri.set(path, t);
    this.triDirty.add(path);
  }

  private load(): Promise<void> {
    return (this.loaded ??= (async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      let files: Record<string, Segment> = {};
      try {
        const m = JSON.parse(await readFile(this.manifest, 'utf8'));
        if (m?.version === VERSION && m.files && typeof m.files === 'object') files = m.files;
      } catch {
        /* noch kein Index */
      }
      const known = new Set<string>();
      for (const [path, s] of Object.entries(files)) {
        // Indexdatei auf den gespeicherten Stand bringen (Absturz nach dem Schreiben, vor dem Manifest)
        try {
          const size = (await stat(this.segPath(s))).size;
          if (size < s.bytes) continue;
          if (size > s.bytes) await truncate(this.segPath(s), s.bytes);
        } catch {
          if (s.bytes > 0) continue;
        }
        this.segments.set(path, s);
        known.add(`${s.id}.txt`).add(`${s.id}.tri`);
        let t: Trigrams | undefined;
        try {
          t = Trigrams.from(new Uint8Array(await readFile(this.triPath(s))));
        } catch {
          /* fehlt (Index aus einer Version ohne Bitfelder) */
        }
        if (t) this.tri.set(path, t);
        else await this.rebuildTrigrams(path, s);
      }
      // Reste alter Versionen oder verworfene Einträge
      for (const n of await readdir(this.dir)) if ((n.endsWith('.txt') || n.endsWith('.tri')) && !known.has(n)) await rm(join(this.dir, n), { force: true });
      if (this.triDirty.size) await this.save();
    })());
  }

  private async save(): Promise<void> {
    this.savedAt = Date.now();
    // erst die Bitfelder, dann das Manifest: ein Bitfeld darf mehr kennen als das Manifest, nie weniger
    for (const p of this.triDirty) {
      const s = this.segments.get(p);
      const t = this.tri.get(p);
      if (s && t) await writeFile(this.triPath(s), t.bytes, { mode: 0o600 });
    }
    this.triDirty.clear();
    const tmp = `${this.manifest}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: VERSION, files: Object.fromEntries(this.segments) }));
    await rename(tmp, this.manifest);
  }

  /**
   * Bringt den Index auf den Stand der übergebenen Transcripts (wichtigste zuerst).
   * `full`: die Liste ist vollständig – was fehlt, hat Claude Code gelöscht und fliegt raus.
   * Läuft schon ein Durchgang, folgt danach genau einer mit der neuesten Liste.
   */
  update(paths: string[], full: boolean): Promise<void> {
    if (this.running) {
      this.next = { paths, full: full || !!this.next?.full };
      if (this.next.full && !full) this.next.paths = [...new Set([...paths, ...this.next.paths])];
      return this.running;
    }
    this.running = (async () => {
      try {
        for (let job: typeof this.next = { paths, full }; job; job = this.next, this.next = undefined) await this.pass(job.paths, job.full);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  private async pass(paths: string[], full: boolean): Promise<void> {
    await this.load();
    if (full) this.progress = { files: 0, total: paths.length };
    let changed = false;
    for (const p of paths) {
      if (await this.indexFile(p)) changed = true;
      if (full) this.progress.files++;
      if (changed && Date.now() - this.savedAt > SAVE_EVERY_MS) await this.save();
    }
    if (full) {
      // Von Claude Code aufgeräumte Transcripts vergessen
      const keep = new Set(paths);
      for (const [p, s] of this.segments) {
        if (keep.has(p)) continue;
        this.segments.delete(p);
        this.tri.delete(p);
        this.triDirty.delete(p);
        await rm(this.segPath(s), { force: true });
        await rm(this.triPath(s), { force: true });
        changed = true;
      }
      this.ready = true;
    }
    if (changed) await this.save();
  }

  /** @returns ob sich etwas geändert hat */
  private async indexFile(path: string): Promise<boolean> {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return false;
    }
    let s = this.segments.get(path);
    if (s && s.offset === size) return false;
    if (!s) {
      s = { id: createHash('sha1').update(path).digest('hex').slice(0, 20), offset: 0, line: 0, bytes: 0 };
      this.segments.set(path, s);
    }
    let t = this.tri.get(path);
    if (!t) this.tri.set(path, (t = new Trigrams()));
    this.triDirty.add(path);
    const tail = new JsonlTail(path);
    tail.offset = s.offset;
    tail.lineNo = s.line;
    for (let more = true; more; ) {
      let lines, reset;
      try {
        ({ lines, more, reset } = await tail.readNew(undefined, CHUNK_BYTES));
      } catch {
        break;
      }
      if (reset) {
        // Datei gekürzt oder ersetzt → neu aufbauen
        await rm(this.segPath(s), { force: true });
        s.bytes = 0;
        this.tri.set(path, (t = new Trigrams()));
      }
      let out = '';
      for (const l of lines) {
        if (l.value === undefined) continue;
        let entries: Entry[];
        try {
          entries = registry.decode<DecodedEntry[]>('transcript', l.value, path, l.line, { silent: true, maxString: Number.MAX_SAFE_INTEGER }).out as Entry[];
        } catch {
          continue;
        }
        for (const e of entries) {
          const raw = searchable(e);
          if (!raw) continue;
          const text = normalize(raw);
          if (!text) continue;
          t.add(text);
          const meta: Meta = [l.line, e.kind, e.timestamp ?? null, e.kind === 'tool-use' ? e.name : null, e.kind === 'tool-use' || e.kind === 'tool-result' ? e.toolUseId : null];
          out += RS + JSON.stringify(meta) + US + text;
        }
      }
      if (out) {
        await appendFile(this.segPath(s), out, { mode: 0o600 });
        s.bytes += Buffer.byteLength(out);
      }
      s.offset = tail.consumed;
      s.line = tail.lineNo;
    }
    if (t.full) await this.rebuildTrigrams(path, s, t.grown());
    return true;
  }

  /**
   * Die besten `max` Treffer in einem Transcript für eine Anfrage (siehe shared/search-query.ts):
   * Bereiche von höchstens `q.window` aufeinanderfolgenden Einträgen mit mindestens `q.min`
   * Begriffen, ohne Überlappung, nach `score` sortiert. Ein Treffer zeigt auf seinen ersten Eintrag.
   * `trigrams` (aus queryTrigrams, je Begriff): Dateien, in denen nicht genug Begriffe stehen
   * können, gar nicht erst lesen.
   */
  async search(path: string, q: SearchQuery, max: number, trigrams: number[][] = []): Promise<IndexedHit[]> {
    const s = this.segments.get(path);
    if (!s || !s.bytes || !q.terms.length) return [];
    const tri = this.tri.get(path);
    if (tri && trigrams.length && trigrams.filter((t) => tri.mayContain(t)).length < q.min) return [];
    let text: string;
    try {
      text = await readFile(this.segPath(s), 'utf8');
    } catch {
      return [];
    }
    // Beginn (RS) und Ende der Metadaten (US) jedes Eintrags
    const starts: number[] = [];
    const seps: number[] = [];
    for (let i = text.indexOf(RS); i !== -1; i = text.indexOf(RS, i + 1)) {
      const sep = text.indexOf(US, i);
      if (sep === -1) break;
      starts.push(i);
      seps.push(sep);
    }
    const entryAt = (pos: number) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const bodyEnd = (k: number) => (k + 1 < starts.length ? starts[k + 1] : text.length);
    const body = (k: number) => text.slice(seps[k] + 1, bodyEnd(k));

    // Fundstellen je Eintrag (relativ zum Text des Eintrags), höchstens CAP je Begriff und Eintrag
    const CAP = 200;
    const found = new Map<number, Pos[]>();
    /** je Begriff: Einträge, in denen er steht, aufsteigend */
    const lists: number[][] = q.terms.map(() => []);
    q.terms.forEach((term, t) => {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let k = -1;
      let n = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const e = entryAt(m.index);
        if (m.index < seps[e]) {
          // Treffer in den Metadaten
          re.lastIndex = seps[e] + 1;
          continue;
        }
        if (e !== k) {
          k = e;
          n = 0;
          lists[t].push(e);
        }
        let ps = found.get(e);
        if (!ps) found.set(e, (ps = []));
        ps.push({ at: m.index - seps[e] - 1, t, len: m[0].length });
        if (++n >= CAP) re.lastIndex = bodyEnd(e);
      }
    });
    for (const ps of found.values()) ps.sort((a, b) => a.at - b.at);
    if (lists.filter((l) => l.length).length < q.min) return [];

    // Kandidaten: ab jedem Eintrag mit Fundstelle das Fenster [s, s + window - 1]
    interface Cand {
      first: number;
      last: number;
      score: number;
      facts: MatchFacts;
      /** je getroffenem Begriff der Eintrag, in dem er (zuerst) steht */
      at: Map<number, number>;
    }
    const cands: Cand[] = [];
    const ptr = q.terms.map(() => 0);
    for (const first of [...found.keys()].sort((a, b) => a - b)) {
      const at = new Map<number, number>();
      lists.forEach((l, t) => {
        while (ptr[t] < l.length && l[ptr[t]] < first) ptr[t]++;
        if (ptr[t] < l.length && l[ptr[t]] < first + q.window) at.set(t, l[ptr[t]]);
      });
      if (at.size < q.min) continue;
      const last = Math.max(...at.values());
      let occurrences = 0;
      for (let k = first; k <= last; k++) for (const p of found.get(k) ?? []) if (at.has(p.t)) occurrences++;
      const facts: MatchFacts = { matched: at.size, span: last - first + 1, occurrences, phrase: false };
      if (facts.span === 1 && at.size > 1) {
        facts.gap = tightest(found.get(first)!)?.gap;
        facts.phrase = at.size === q.terms.length && body(first).toLowerCase().includes(q.literal);
      }
      cands.push({ first, last, score: score(q, facts, 'text'), facts, at });
    }

    // die besten, ohne Überlappung
    cands.sort((a, b) => b.score - a.score || a.first - b.first);
    const taken: Cand[] = [];
    for (const c of cands) {
      if (taken.length >= max) break;
      if (taken.some((o) => c.first <= o.last && o.first <= c.last)) continue;
      taken.push(c);
    }

    const hits: IndexedHit[] = [];
    for (const c of taken) {
      try {
        const [line, kind, ts, toolName, toolUseId] = JSON.parse(text.slice(starts[c.first] + 1, seps[c.first])) as Meta;
        // Ausschnitt: alle getroffenen Begriffe, je Eintrag des Bereichs
        const parts: string[] = [];
        for (let k = c.first; k <= c.last; k++) {
          const ps = (found.get(k) ?? []).filter((p) => c.at.get(p.t) === k);
          if (!ps.length) continue;
          const tight = tightest(ps);
          const marks = tight && tight.end - tight.start <= 240 ? [{ at: tight.start, len: tight.end - tight.start }] : [...new Map(ps.map((p) => [p.t, p])).values()];
          parts.push(fragments(body(k), marks));
        }
        hits.push({
          line,
          kind,
          ts: ts ?? undefined,
          toolName: toolName ?? undefined,
          toolUseId: toolUseId ?? undefined,
          snippet: parts.join(' ⋯ '),
          span: c.facts.span > 1 ? c.facts.span : undefined,
          matched: c.facts.matched,
          score: c.score,
        });
      } catch {
        /* angeschnittener Eintrag */
      }
    }
    return hits;
  }

  /** Größe des Index auf der Platte (Bytes) */
  get bytes(): number {
    let n = 0;
    for (const s of this.segments.values()) n += s.bytes;
    return n;
  }
}
