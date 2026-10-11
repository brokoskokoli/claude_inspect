import { availableParallelism } from 'node:os';
import { appendFile, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { CpuHistory, CpuSnapshot } from '../shared/types.js';
import { DATA_DIR } from './config.js';
import { computeUsage, cpuHistory, CSV_HEADER, parseCsv, sampleTotal, toCsv, type CpuSample, type CpuTable } from './model/cpu.js';
import { readCpuTable } from './sources/cputable.js';

/** So lange bleiben Messungen im Speicher (Verlauf ohne Aufzeichnung, Sparkline). */
const MEMORY_MS = 60 * 60_000;
/** Punkte der Sparkline auf dem Dashboard */
const SPARK_POINTS = 120;
/** Unterprozesse unter dieser Auslastung (%) landen nicht in der Datei. */
const MIN_PCT = 1;
/** Ruhige Phasen: höchstens alle 30 s eine Zeile, damit die Datei klein bleibt. */
const IDLE_WRITE_MS = 30_000;
/** Dateien, die so lange nicht mehr geschrieben wurden, werden gelöscht (wie Claude Codes eigene Aufräumfrist). */
const RETENTION_MS = 30 * 24 * 3600_000;

export interface CpuMonitorOptions {
  /** Messwerte als CSV in DATA_DIR/cpu ablegen */
  log: boolean;
  /** laufende Claude-Prozesse: pid → sessionId */
  roots: () => Map<number, string>;
  onSample: (snap: CpuSnapshot) => void;
}

interface SessionBuffer {
  samples: CpuSample[];
  lastWrite: number;
}

/**
 * Misst in festen Abständen die CPU-Auslastung jedes Claude-Prozesses samt Unterprozessen.
 * Liest die Prozesstabelle (ps bzw. /proc), schreibt nur ins eigene Datenverzeichnis.
 */
export class CpuMonitor {
  readonly intervalMs = process.platform === 'win32' ? 10_000 : 3_000;
  readonly dir = join(DATA_DIR, 'cpu');
  readonly cores = availableParallelism();
  private prev?: CpuTable;
  private lastT = 0;
  private buffers = new Map<string, SessionBuffer>();
  private writing = Promise.resolve();
  private headerDone = new Set<string>();
  private warned = false;
  private busy = false;
  private timer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private opts: CpuMonitorOptions) {}

  get logging(): boolean {
    return this.opts.log;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (this.opts.log) {
      void this.cleanup();
      this.cleanupTimer = setInterval(() => void this.cleanup(), 6 * 3600_000);
      this.cleanupTimer.unref();
    }
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.cleanupTimer);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const roots = this.opts.roots();
      const cur: CpuTable = { t: Date.now(), procs: await readCpuTable() };
      if (this.prev && cur.procs.size > 0) {
        for (const [sessionId, procs] of computeUsage(this.prev, cur, roots)) this.record(sessionId, { t: cur.t, procs });
        this.lastT = cur.t;
        for (const [id, b] of this.buffers) if (cur.t - b.samples[b.samples.length - 1].t > MEMORY_MS) this.buffers.delete(id);
        this.opts.onSample(this.snapshot());
      }
      if (cur.procs.size > 0) this.prev = cur;
    } catch {
      /* nächste Runde */
    } finally {
      this.busy = false;
    }
  }

  private record(sessionId: string, sample: CpuSample): void {
    let b = this.buffers.get(sessionId);
    if (!b) this.buffers.set(sessionId, (b = { samples: [], lastWrite: 0 }));
    b.samples.push(sample);
    while (b.samples.length && sample.t - b.samples[0].t > MEMORY_MS) b.samples.shift();
    if (!this.opts.log || !/^[\w-]+$/.test(sessionId)) return;
    if (sampleTotal(sample) < MIN_PCT && sample.t - b.lastWrite < IDLE_WRITE_MS) return;
    b.lastWrite = sample.t;
    // Claude-Prozess immer (markiert die Messung), Unterprozesse nur, wenn sie etwas tun
    const rows = sample.procs.filter((p, i) => i === 0 || p.pct >= MIN_PCT);
    const file = join(this.dir, `${sessionId}.csv`);
    this.writing = this.writing.then(() => this.append(file, toCsv({ t: sample.t, procs: rows })));
  }

  private async append(file: string, text: string): Promise<void> {
    try {
      if (!this.headerDone.has(file)) {
        await mkdir(this.dir, { recursive: true });
        try {
          await stat(file);
        } catch {
          text = CSV_HEADER + text;
        }
        this.headerDone.add(file);
      }
      await appendFile(file, text);
    } catch (e) {
      if (!this.warned) console.error(`claude-inspect: cannot write CPU log to ${this.dir}: ${(e as Error).message}`);
      this.warned = true;
    }
  }

  private async cleanup(): Promise<void> {
    try {
      for (const name of await readdir(this.dir)) {
        if (!name.endsWith('.csv')) continue;
        const file = join(this.dir, name);
        if (Date.now() - (await stat(file)).mtimeMs > RETENTION_MS) await unlink(file);
      }
    } catch {
      /* Verzeichnis gibt es (noch) nicht */
    }
  }

  /** Aktuelle Auslastung der Sessions, die bei der letzten Messung liefen. */
  snapshot(): CpuSnapshot {
    const sessions: CpuSnapshot['sessions'] = {};
    for (const [id, b] of this.buffers) {
      const last = b.samples[b.samples.length - 1];
      if (last.t !== this.lastT) continue;
      sessions[id] = { pct: sampleTotal(last), spark: b.samples.slice(-SPARK_POINTS).map(sampleTotal) };
    }
    return { t: this.lastT, intervalMs: this.intervalMs, cores: this.cores, sessions };
  }

  async history(sessionId: string): Promise<CpuHistory> {
    let samples: CpuSample[] = [];
    const file = this.opts.log && /^[\w-]+$/.test(sessionId) ? join(this.dir, `${sessionId}.csv`) : undefined;
    if (file) {
      try {
        samples = parseCsv(await readFile(file, 'utf8'));
      } catch {
        /* noch nichts aufgezeichnet */
      }
    }
    // Messungen, die (noch) nicht in der Datei stehen, aus dem Speicher ergänzen
    const lastT = samples[samples.length - 1]?.t ?? 0;
    samples.push(...(this.buffers.get(sessionId)?.samples.filter((s) => s.t > lastT) ?? []));
    const h = cpuHistory(samples, { intervalMs: this.intervalMs, gapMs: IDLE_WRITE_MS + 5 * this.intervalMs });
    return { sessionId, logging: this.opts.log, file: samples.length ? file : undefined, cores: this.cores, ...h };
  }
}
