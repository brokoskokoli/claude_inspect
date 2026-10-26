import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Entry } from '../../shared/types.js';
import { toolSummary } from '../../shared/tools.js';
import { registry } from '../formats/index.js';
import type { DecodedEntry } from '../formats/transcript/common.js';
import { JsonlTail } from '../util/jsonl.js';
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

function snippet(text: string, at: number, len: number, radius = 90): string {
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + len + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
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
   * Treffer in einem Transcript, höchstens einer je Eintrag. `trigrams` (aus queryTrigrams):
   * Dateien, die nicht alle enthalten, gar nicht erst lesen. `re` braucht das Flag `g`;
   * Suchbegriffe ohne Trennzeichen (siehe normalize), damit kein Treffer zwei Einträge überspannt.
   */
  async search(path: string, re: RegExp, max: number, trigrams: number[] = []): Promise<IndexedHit[]> {
    const s = this.segments.get(path);
    if (!s || !s.bytes) return [];
    if (trigrams.length && this.tri.get(path)?.mayContain(trigrams) === false) return [];
    let text: string;
    try {
      text = await readFile(this.segPath(s), 'utf8');
    } catch {
      return [];
    }
    const hits: IndexedHit[] = [];
    re.lastIndex = 0;
    for (let m = re.exec(text); m && hits.length < max; m = re.exec(text)) {
      const start = text.lastIndexOf(RS, m.index);
      const sep = text.indexOf(US, start);
      if (start < 0 || sep < 0) break;
      if (m.index < sep) {
        // Treffer in den Metadaten
        re.lastIndex = sep + 1;
        continue;
      }
      let end = text.indexOf(RS, sep);
      if (end < 0) end = text.length;
      try {
        const [line, kind, ts, toolName, toolUseId] = JSON.parse(text.slice(start + 1, sep)) as Meta;
        const body = text.slice(sep + 1, end);
        hits.push({ line, kind, ts: ts ?? undefined, toolName: toolName ?? undefined, toolUseId: toolUseId ?? undefined, snippet: snippet(body, m.index - sep - 1, m[0].length) });
      } catch {
        /* angeschnittener Eintrag */
      }
      re.lastIndex = end;
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
