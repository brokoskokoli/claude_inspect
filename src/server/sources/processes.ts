import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessInfo } from '../../shared/types.js';
import { paths } from '../config.js';
import { registry } from '../formats/index.js';
import type { DecodedProcess } from '../formats/process/session-file.js';
import { readJson } from '../util/jsonl.js';

/**
 * Startzeiten laufender Prozesse per `ps` (rein lesend).
 * TZ=UTC, weil Claude Code `procStart` in UTC schreibt.
 */
function procStarts(pids: number[]): Promise<Map<number, string>> {
  return new Promise((resolve) => {
    if (pids.length === 0 || process.platform === 'win32') return resolve(new Map());
    execFile(
      'ps',
      ['-o', 'pid=,lstart=', '-p', pids.join(',')],
      { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, timeout: 5000 },
      (_err, stdout) => {
        // ps endet mit Code 1, wenn einzelne PIDs fehlen – die Ausgabe ist trotzdem gültig.
        const out = new Map<number, string>();
        for (const line of String(stdout ?? '').split('\n')) {
          const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
          if (m) out.set(Number(m[1]), m[2]);
        }
        resolve(out);
      },
    );
  });
}

/** Eltern-PID und Programmname aller Prozesse (`ps -A`), für die Zuordnung per Prozessbaum. */
function processTable(): Promise<Map<number, { ppid: number; comm: string }>> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') return resolve(new Map());
    execFile('ps', ['-A', '-o', 'pid=,ppid=,comm='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => {
      const out = new Map<number, { ppid: number; comm: string }>();
      for (const line of String(stdout ?? '').split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m) out.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3].trim().split('/').pop() ?? '' });
      }
      resolve(out);
    });
  });
}

/**
 * Programme, die zwischen aufrufendem Agenten und gestartetem claude liegen dürfen
 * (Bash-Tool → Shell → evtl. Wrapper → claude). Alles andere – etwa der Daemon,
 * der Hintergrund-Jobs forkt – ist keine Aufrufbeziehung.
 */
const LAUNCH_INTERMEDIATES = new Set(['sh', 'zsh', 'bash', 'dash', 'fish', '-zsh', '-bash', 'env', 'caffeinate', 'timeout', 'gtimeout', 'nohup', 'time', 'script', 'xargs', 'stdbuf', 'nice', 'sudo']);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function readProcesses(): Promise<ProcessInfo[]> {
  let names: string[] = [];
  try {
    names = await readdir(paths.sessions);
  } catch {
    return [];
  }
  const decoded: ProcessInfo[] = [];
  const procStart = new Map<number, string | undefined>();
  for (const name of names) {
    // <pid>.json – die <pid>.<hash>.key-Dateien enthalten Tokens und werden nie gelesen.
    if (!/^\d+\.json$/.test(name)) continue;
    const file = join(paths.sessions, name);
    try {
      const { out, decoder } = registry.decode<DecodedProcess>('process', await readJson(file), file);
      const { procStart: ps, ...rest } = out;
      procStart.set(rest.pid, ps);
      decoded.push({ ...rest, alive: false, file, decoder });
    } catch {
      /* halb geschrieben oder gelöscht */
    }
  }
  const [running, table] = await Promise.all([procStarts(decoded.map((p) => p.pid).filter((p) => p > 0)), processTable()]);
  for (const p of decoded) {
    const actual = running.get(p.pid);
    const expected = procStart.get(p.pid);
    p.alive = actual !== undefined && (!expected || norm(actual) === norm(expected));
  }
  // Prozessbaum hochlaufen (claude → zsh → claude …) bis zum nächsten bekannten Claude-Prozess.
  const alivePids = new Set(decoded.filter((p) => p.alive).map((p) => p.pid));
  for (const p of decoded) {
    if (!p.alive || p.kind === 'bg') continue;
    let cur = table.get(p.pid)?.ppid;
    for (let depth = 0; cur && cur > 1 && depth < 8; depth++) {
      if (alivePids.has(cur)) {
        p.parentPid = cur;
        break;
      }
      const row = table.get(cur);
      if (!row || !LAUNCH_INTERMEDIATES.has(row.comm)) break;
      cur = row.ppid;
    }
  }
  return decoded;
}
