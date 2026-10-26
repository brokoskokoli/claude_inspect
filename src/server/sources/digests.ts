import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** erhöhen, wenn sich Inhalt oder Berechnung der Kennzahlen ändert – alte Einträge gelten dann nicht mehr */
const VERSION = 1;

/**
 * Kennzahlen je Transcript auf der Platte (eine kleine JSON-Datei je Transcript), gültig solange
 * die Datei nicht gewachsen ist. Bleibt zwischen Neustarts erhalten und belegt keinen Arbeitsspeicher;
 * große Agentenbäume müssen so nur einmal komplett eingelesen werden.
 */
export class DigestCache<T> {
  private ready?: Promise<unknown>;

  constructor(private readonly dir: string) {}

  private name(path: string): string {
    return `${createHash('sha1').update(path).digest('hex').slice(0, 20)}.json`;
  }

  /** gespeicherte Kennzahlen samt der Bytes, zu denen sie gehören (vergleichen muss der Aufrufer) */
  async read(path: string): Promise<{ bytes: number; data: T } | undefined> {
    try {
      const d = JSON.parse(await readFile(join(this.dir, this.name(path)), 'utf8'));
      if (d.v === VERSION && d.path === path) return { bytes: d.bytes, data: d.data };
    } catch {
      /* noch nicht berechnet oder unlesbar */
    }
    return undefined;
  }

  async set(path: string, bytes: number, data: T): Promise<void> {
    try {
      await (this.ready ??= mkdir(this.dir, { recursive: true, mode: 0o700 }));
      const file = join(this.dir, this.name(path));
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ v: VERSION, path, bytes, data }), { mode: 0o600 });
      await rename(tmp, file);
    } catch {
      /* nur ein Zwischenspeicher – beim nächsten Mal wird neu berechnet */
    }
  }

  /** Einträge zu Transcripts entfernen, die es nicht mehr gibt (`paths`: alle vorhandenen) */
  async prune(paths: string[]): Promise<void> {
    const keep = new Set(paths.map((p) => this.name(p)));
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const n of names) if (n.endsWith('.json') && !keep.has(n)) await rm(join(this.dir, n), { force: true });
  }
}
