import type { Entry } from '../../shared/types.js';
import { LIMITS } from '../config.js';
import { registry } from '../formats/index.js';
import type { DecodedEntry } from '../formats/transcript/common.js';
import { JsonlTail, readLineAt } from '../util/jsonl.js';

/** Ein geladenes Transcript (Hauptsession oder Subagent), inkrementell nachgeführt. */
export class Transcript {
  entries: Entry[] = [];
  /** Byte-Offset je Zeilennummer – für die Rohansicht. */
  private lineOffsets = new Map<number, number>();
  private tail: JsonlTail;
  lastAccess = Date.now();

  constructor(
    readonly path: string,
    readonly sessionId: string,
    readonly agentId?: string,
  ) {
    this.tail = new JsonlTail(path);
  }

  get bytes(): number {
    return this.tail.offset;
  }

  /** Liest neue Zeilen. Gibt die Anzahl neuer Einträge zurück (-1 = komplett neu geladen). */
  async refresh(): Promise<number> {
    const { lines, reset } = await this.tail.readNew();
    if (reset) {
      this.entries = [];
      this.lineOffsets.clear();
    }
    const before = this.entries.length;
    for (const l of lines) {
      this.lineOffsets.set(l.line, l.offset);
      let decoded: DecodedEntry[];
      let decoder: string;
      if (l.error !== undefined) {
        decoded = [{ kind: 'unknown', recordType: '(defekte Zeile)', raw: l.error }];
        decoder = 'jsonl.parse-error';
      } else {
        ({ out: decoded, decoder } = registry.decode<DecodedEntry[]>('transcript', l.value, this.path, l.line));
      }
      for (const d of decoded) {
        this.entries.push({ ...d, seq: this.entries.length, line: l.line, decoder } as Entry);
      }
    }
    return reset ? -1 : this.entries.length - before;
  }

  async rawLine(line: number): Promise<string | undefined> {
    const off = this.lineOffsets.get(line);
    if (off === undefined) return undefined;
    return readLineAt(this.path, off, LIMITS.maxRawLine);
  }
}

/**
 * Hält geladene Transcripts im Speicher (LRU mit Byte-Budget).
 * Nichts wird auf Platte gespeichert.
 */
export class TranscriptStore {
  private loaded = new Map<string, Transcript>();
  private loading = new Map<string, Promise<Transcript>>();

  isLoaded(path: string): boolean {
    return this.loaded.has(path);
  }

  peek(path: string): Transcript | undefined {
    return this.loaded.get(path);
  }

  async get(path: string, sessionId: string, agentId?: string): Promise<Transcript> {
    const t = this.loaded.get(path);
    if (t) {
      t.lastAccess = Date.now();
      return t;
    }
    let p = this.loading.get(path);
    if (!p) {
      p = (async () => {
        const nt = new Transcript(path, sessionId, agentId);
        await nt.refresh();
        this.loaded.set(path, nt);
        this.evict();
        return nt;
      })().finally(() => this.loading.delete(path));
      this.loading.set(path, p);
    }
    return p;
  }

  /** Nach einer Dateiänderung: nur nachladen, wenn das Transcript bereits im Speicher ist. */
  async refreshIfLoaded(path: string): Promise<{ transcript: Transcript; added: number } | undefined> {
    const t = this.loaded.get(path);
    if (!t) return undefined;
    try {
      const added = await t.refresh();
      return added === 0 ? undefined : { transcript: t, added };
    } catch {
      // Datei gelöscht (Claude Code räumt auf) → aus dem Speicher nehmen
      this.loaded.delete(path);
      return undefined;
    }
  }

  all(): Transcript[] {
    return [...this.loaded.values()];
  }

  private evict(): void {
    let total = 0;
    for (const t of this.loaded.values()) total += t.bytes;
    if (total <= LIMITS.transcriptCacheBytes) return;
    const byAge = [...this.loaded.values()].sort((a, b) => a.lastAccess - b.lastAccess);
    for (const t of byAge) {
      if (total <= LIMITS.transcriptCacheBytes * 0.8) break;
      if (Date.now() - t.lastAccess < 60_000) continue; // gerade benutzt
      this.loaded.delete(t.path);
      total -= t.bytes;
    }
  }
}
