import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeUsage, cpuHistory, parseCsv, toCsv, type CpuSample, type CpuTable } from '../src/server/model/cpu.js';
import { parsePsTable, parsePsTime, parseProcStat, type CpuProc } from '../src/server/sources/cputable.js';

test('parsePsTime reads macOS and Linux/BSD formats', () => {
  assert.equal(parsePsTime('0:26.61'), 26_610);
  assert.equal(parsePsTime('825:37.82'), (825 * 60 + 37.82) * 1000, 'macOS: minutes above 60');
  assert.equal(parsePsTime('01:02:03'), 3723_000);
  assert.equal(parsePsTime('2-01:00:00'), 49 * 3600_000);
  assert.equal(parsePsTime('-'), undefined);
});

test('parsePsTable keeps the program name without path, spaces included', () => {
  const t = parsePsTable('  51091 49248   0:26.61 claude\n  612     1   1:00.00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\ngarbage\n');
  assert.deepEqual(t.get(51091), { pid: 51091, ppid: 49248, cpuMs: 26_610, comm: 'claude' });
  assert.equal(t.get(612)?.comm, 'Google Chrome');
  assert.equal(t.size, 2);
});

test('parseProcStat handles parentheses in the program name', () => {
  // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime …
  const p = parseProcStat('4242 (node (worker)) S 4200 4242 4242 0 -1 4194304 100 0 0 0 250 50 0 0 20 0 1 0');
  assert.deepEqual(p, { pid: 4242, ppid: 4200, comm: 'node (worker)', cpuMs: 3000 });
});

const table = (t: number, rows: [pid: number, ppid: number, comm: string, cpuMs: number][]): CpuTable => ({
  t,
  procs: new Map(rows.map(([pid, ppid, comm, cpuMs]) => [pid, { pid, ppid, comm, cpuMs } satisfies CpuProc])),
});

test('computeUsage sums the claude process tree and stops at other claude processes', () => {
  const prev = table(0, [
    [100, 1, 'claude', 1000],
    [101, 100, 'zsh', 0],
    [102, 101, 'cargo', 5000],
    [200, 101, 'claude', 0], // per Bash gestarteter claude – eigene Kurve
    [300, 1, 'other', 0],
  ]);
  const cur = table(3000, [
    [100, 1, 'claude', 1300],
    [101, 100, 'zsh', 0],
    [102, 101, 'cargo', 11_000],
    [103, 102, 'rustc', 1500], // neu seit der letzten Messung
    [200, 101, 'claude', 600],
    [201, 200, 'node', 3000],
    [300, 1, 'other', 9000],
  ]);
  const u = computeUsage(prev, cur, new Map([[100, 'A'], [200, 'B']]));
  assert.deepEqual(
    u.get('A')!.map((r) => [r.comm, r.pct]),
    [['claude', 10], ['zsh', 0], ['cargo', 200], ['rustc', 50]],
  );
  assert.deepEqual(
    u.get('B')!.map((r) => [r.comm, r.pct]),
    [['claude', 20], ['node', 100]],
  );
});

test('computeUsage treats a reused PID as a new process', () => {
  const prev = table(0, [[100, 1, 'claude', 0], [101, 100, 'make', 90_000]]);
  const cur = table(1000, [[100, 1, 'claude', 0], [101, 100, 'python3', 500]]);
  assert.equal(computeUsage(prev, cur, new Map([[100, 'A']])).get('A')![1].pct, 50);
});

test('CSV round trip, also with commas and quotes in names', () => {
  const s: CpuSample = { t: Date.parse('2026-10-11T12:00:03Z'), procs: [{ pid: 1, ppid: 0, comm: 'claude', pct: 4.5 }, { pid: 2, ppid: 1, comm: 'a,"b"', pct: 120 }] };
  const text = 'ts,pid,ppid,comm,cpu_pct\n' + toCsv(s) + toCsv({ ...s, t: s.t + 3000 });
  const back = parseCsv(text);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0], s);
});

test('cpuHistory: series by process name, other bucket, gaps without measurement', () => {
  const at = (sec: number, procs: [string, number][]): CpuSample => ({ t: sec * 1000, procs: procs.map(([comm, pct], i) => ({ pid: i + 1, ppid: 0, comm, pct })) });
  const samples = [
    at(0, [['claude', 10], ['cargo', 200]]),
    at(3, [['claude', 10], ['cargo', 100], ['zsh', 2]]),
    // 30 s Ruhe (wird nicht geschrieben) – kein Loch
    at(33, [['claude', 0]]),
    // 10 min claude-inspect aus – Loch
    at(633, [['claude', 50]]),
  ];
  const h = cpuHistory(samples, { intervalMs: 3000, gapMs: 45_000, series: 2 });
  assert.deepEqual(h.keys, ['cargo', 'claude', 'other']);
  assert.equal(h.peak, 210);
  assert.deepEqual(h.points[0].values, [200, 10, 0]);
  assert.deepEqual(h.points[1].values, [100, 10, 2]);
  assert.deepEqual(h.points[5].values, [0, 0, 0], 'quiet stretch takes the next measurement');
  assert.equal(h.points[20].values, null, 'not measured');
  assert.deepEqual(h.points[h.points.length - 1].values, [0, 50, 0]);
  assert.ok(h.points.length <= 600);
  // Prozesse ohne CPU-Zeit: nicht in der Tabelle und kein leeres "other"
  const idle = cpuHistory([at(0, [['claude', 5], ['sleep', 0]])], { intervalMs: 3000, gapMs: 45_000 });
  assert.deepEqual(idle.keys, ['claude']);
  assert.deepEqual(idle.processes.map((p) => p.comm), ['claude']);
  // Messabstände schwanken (3,02 s statt 3 s): kein falscher Einbruch auf 0
  const jitter = [0, 2990, 6100, 9000].map((t) => ({ t, procs: [{ pid: 1, ppid: 0, comm: 'yes', pct: 80 }] }));
  const hj = cpuHistory(jitter, { intervalMs: 3000, gapMs: 45_000 });
  assert.ok(hj.points.every((p) => p.values?.[0] === 80), JSON.stringify(hj.points));
  // cargo: 200 % für 3 s (erste Messung) + 100 % für 3 s = 9 CPU-Sekunden
  assert.equal(h.processes[0].comm, 'cargo');
  assert.equal(h.processes[0].cpuSeconds, 9);
});
