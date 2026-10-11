import type { CpuHistory, CpuProcessStat } from '../../shared/types.js';
import type { CpuProc } from '../sources/cputable.js';

/** Auslastung eines Prozesses zwischen zwei Messungen (100 % = ein Kern). */
export interface CpuUsage {
  pid: number;
  ppid: number;
  comm: string;
  pct: number;
}

/** Eine Messung für eine Session: Claude-Prozess zuerst, danach seine Unterprozesse. */
export interface CpuSample {
  t: number;
  procs: CpuUsage[];
}

export interface CpuTable {
  t: number;
  procs: Map<number, CpuProc>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Auslastung je Claude-Prozess (`roots`: pid → sessionId) samt aller Nachfahren.
 * Ein Nachfahre, der selbst ein Claude-Prozess ist, zählt nicht mit – er hat seine eigene Kurve.
 * Prozesse, die es in `prev` nicht gab (oder deren PID neu vergeben wurde), sind seitdem gestartet:
 * ihre gesamte CPU-Zeit fällt in dieses Intervall.
 */
export function computeUsage(prev: CpuTable, cur: CpuTable, roots: Map<number, string>): Map<string, CpuUsage[]> {
  const dt = cur.t - prev.t;
  const out = new Map<string, CpuUsage[]>();
  if (dt <= 0) return out;
  const children = new Map<number, number[]>();
  for (const p of cur.procs.values()) {
    if (p.ppid === p.pid) continue;
    const list = children.get(p.ppid);
    if (list) list.push(p.pid);
    else children.set(p.ppid, [p.pid]);
  }
  const pct = (p: CpuProc) => {
    const before = prev.procs.get(p.pid);
    const base = before && before.comm === p.comm && before.cpuMs <= p.cpuMs ? before.cpuMs : 0;
    return Math.max(0, ((p.cpuMs - base) / dt) * 100);
  };
  for (const [rootPid, sessionId] of roots) {
    const root = cur.procs.get(rootPid);
    if (!root) continue;
    const rows: CpuUsage[] = [];
    const seen = new Set<number>();
    const queue = [rootPid];
    while (queue.length) {
      const pid = queue.shift()!;
      if (seen.has(pid)) continue;
      seen.add(pid);
      const p = cur.procs.get(pid)!;
      rows.push({ pid, ppid: p.ppid, comm: p.comm, pct: round1(pct(p)) });
      for (const c of children.get(pid) ?? []) if (!roots.has(c)) queue.push(c);
    }
    out.set(sessionId, rows);
  }
  return out;
}

export const sampleTotal = (s: CpuSample) => round1(s.procs.reduce((a, p) => a + p.pct, 0));

// --- CSV ---------------------------------------------------------------------

export const CSV_HEADER = 'ts,pid,ppid,comm,cpu_pct\n';

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(s: CpuSample): string {
  const ts = new Date(s.t).toISOString();
  return s.procs.map((p) => `${ts},${p.pid},${p.ppid},${csvField(p.comm)},${p.pct}\n`).join('');
}

/** Liest die eigene CSV-Datei wieder ein; Zeilen mit gleichem Zeitstempel bilden eine Messung. */
export function parseCsv(text: string): CpuSample[] {
  const out: CpuSample[] = [];
  let cur: CpuSample | undefined;
  for (const line of text.split('\n')) {
    const m = /^([^,]+),(\d+),(\d+),("(?:[^"]|"")*"|[^,]*),([\d.]+)\r?$/.exec(line);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (Number.isNaN(t)) continue;
    const comm = m[4].startsWith('"') ? m[4].slice(1, -1).replace(/""/g, '"') : m[4];
    if (!cur || cur.t !== t) {
      cur = { t, procs: [] };
      out.push(cur);
    }
    cur.procs.push({ pid: Number(m[2]), ppid: Number(m[3]), comm, pct: Number(m[5]) });
  }
  return out;
}

// --- Verlauf für die Anzeige -------------------------------------------------

export interface HistoryOptions {
  /** Messabstand – längere Lücken zwischen zwei Messungen werden nicht hochgerechnet */
  intervalMs: number;
  /** Ab dieser Lücke gilt ein Abschnitt als "nicht gemessen" */
  gapMs: number;
  maxPoints?: number;
  /** so viele Prozessnamen als eigene Reihe, der Rest als "other" */
  series?: number;
}

/** Fasst Messungen zu höchstens `maxPoints` Zeitabschnitten zusammen, je Prozessname eine Reihe. */
export function cpuHistory(samples: CpuSample[], opts: HistoryOptions): Omit<CpuHistory, 'sessionId' | 'logging' | 'file' | 'cores'> {
  const maxPoints = opts.maxPoints ?? 600;
  const series = opts.series ?? 6;
  const stats = new Map<string, CpuProcessStat & { pidSet: Set<number> }>();
  let peak = 0;
  let cpuSeconds = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Anteil dieser Messung an der Zeit: Abstand zur vorigen, höchstens zwei Messabstände
    const dt = Math.min(i > 0 ? s.t - samples[i - 1].t : opts.intervalMs, 2 * opts.intervalMs) / 1000;
    const byComm = new Map<string, number>();
    for (const p of s.procs) {
      byComm.set(p.comm, (byComm.get(p.comm) ?? 0) + p.pct);
      let st = stats.get(p.comm);
      if (!st) stats.set(p.comm, (st = { comm: p.comm, cpuSeconds: 0, peak: 0, pids: 0, pidSet: new Set() }));
      st.cpuSeconds += (p.pct / 100) * dt;
      st.pidSet.add(p.pid);
    }
    for (const [comm, v] of byComm) stats.get(comm)!.peak = Math.max(stats.get(comm)!.peak, v);
    const total = sampleTotal(s);
    peak = Math.max(peak, total);
    cpuSeconds += (total / 100) * dt;
  }
  const processes = [...stats.values()]
    .map(({ pidSet, ...st }) => ({ ...st, pids: pidSet.size, cpuSeconds: round1(st.cpuSeconds), peak: round1(st.peak) }))
    .filter((p) => p.cpuSeconds > 0)
    .sort((a, b) => b.cpuSeconds - a.cpuSeconds);
  const named = processes.slice(0, series).map((p) => p.comm);
  const hasOther = processes.some((p) => p.cpuSeconds > 0 && !named.includes(p.comm));
  const keys = hasOther ? [...named, 'other'] : named;
  const slot = (comm: string) => {
    const i = named.indexOf(comm);
    return i >= 0 ? i : named.length;
  };

  const base = { keys, processes, cpuSeconds: round1(cpuSeconds), peak: round1(peak) };
  if (samples.length === 0) return { ...base, bucketMs: opts.intervalMs, points: [] };
  const from = samples[0].t;
  const to = samples[samples.length - 1].t;
  const bucketMs = Math.max(opts.intervalMs, Math.ceil((to - from + 1) / maxPoints / 1000) * 1000);
  const n = Math.floor((to - from) / bucketMs) + 1;
  const sums = Array.from({ length: n }, () => ({ count: 0, values: new Array<number>(keys.length).fill(0) }));
  for (const s of samples) {
    const b = sums[Math.floor((s.t - from) / bucketMs)];
    b.count++;
    for (const p of s.procs) b.values[slot(p.comm)] += p.pct;
  }
  // Leere Abschnitte: Eine Messung gibt den Mittelwert seit der vorigen an, also gilt für den
  // Abschnitt die nächste Messung. Bei größeren Lücken: "nicht gemessen".
  const points: CpuHistory['points'] = [];
  let si = 0;
  for (let i = 0; i < n; i++) {
    const t = from + i * bucketMs;
    const b = sums[i];
    if (b.count > 0) {
      points.push({ t, values: b.values.map((v) => round1(v / b.count)) });
      continue;
    }
    while (si < samples.length - 1 && samples[si + 1].t < t) si++;
    const next = samples[si + 1];
    if (!next || next.t - samples[si].t > opts.gapMs) {
      points.push({ t, values: null });
      continue;
    }
    const values = new Array<number>(keys.length).fill(0);
    for (const p of next.procs) values[slot(p.comm)] += p.pct;
    points.push({ t, values: values.map(round1) });
  }
  return { ...base, bucketMs, points };
}
