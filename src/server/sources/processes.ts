import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessInfo } from '../../shared/types.js';
import { paths } from '../config.js';
import { registry } from '../formats/index.js';
import type { DecodedProcess } from '../formats/process/session-file.js';
import { readJson } from '../util/jsonl.js';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

interface ProcRow {
  ppid: number;
  /** Programmname ohne Pfad und ohne ".exe", klein geschrieben unter Windows */
  comm: string;
  /** Startzeit wie vom System geliefert (Unix: `ps lstart` in UTC, Windows: ISO in UTC) */
  start?: string;
}

/**
 * Startzeiten laufender Prozesse per `ps` (rein lesend).
 * TZ=UTC, weil Claude Code `procStart` in UTC schreibt.
 */
function procStarts(pids: number[]): Promise<Map<number, string>> {
  return new Promise((resolve) => {
    if (pids.length === 0) return resolve(new Map());
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
function unixTable(): Promise<Map<number, ProcRow>> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,comm='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => {
      const out = new Map<number, ProcRow>();
      for (const line of String(stdout ?? '').split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m) out.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3].trim().split('/').pop() ?? '' });
      }
      resolve(out);
    });
  });
}

/** Windows: Prozesstabelle inkl. Startzeit per CIM (rein lesend). */
const WIN_PS =
  "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, " +
  "$(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '-' }), $_.Name }";

function windowsTable(): Promise<Map<number, ProcRow>> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WIN_PS],
      { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (_err, stdout) => {
        const out = new Map<number, ProcRow>();
        for (const line of String(stdout ?? '').split(/\r?\n/)) {
          const m = /^(\d+) (\d+) (\S+) (.*)$/.exec(line.trim());
          if (m) out.set(Number(m[1]), { ppid: Number(m[2]), start: m[3] === '-' ? undefined : m[3], comm: m[4].toLowerCase().replace(/\.exe$/, '') });
        }
        resolve(out);
      },
    );
  });
}

// PowerShell zu starten kostet spürbar CPU – die Tabelle wird unter Windows kurz zwischengespeichert.
let winCache: { at: number; table: Promise<Map<number, ProcRow>> } | undefined;
function cachedWindowsTable(): Promise<Map<number, ProcRow>> {
  if (!winCache || Date.now() - winCache.at > 5000) winCache = { at: Date.now(), table: windowsTable() };
  return winCache.table;
}

/** Startzeit als Epoch-ms. `ps lstart` ("Mon Sep 28 19:15:43 2026") hat keine Zone und ist UTC. */
function parseStart(s: string | number | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  if (typeof s === 'number' || /^\d+$/.test(s)) return Number(s);
  const zoned = /(?:Z|[+-]\d{2}:?\d{2}|UTC|GMT)$/.test(s.trim());
  const t = Date.parse(zoned ? s : `${s} UTC`);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * Läuft der Prozess noch, und ist es derselbe (PIDs werden wiederverwendet)?
 * Exakter Textvergleich, wo das Format bekannt ist; sonst Vergleich als Zeitpunkt.
 * Ist `procStart` unbekannt oder unlesbar, reicht die Existenz der PID.
 */
export function sameProcess(actual: string | undefined, expected: string | undefined): boolean {
  if (actual === undefined) return false;
  if (!expected || norm(actual) === norm(expected)) return true;
  const a = parseStart(actual);
  const e = parseStart(expected);
  if (a !== undefined && e !== undefined) return Math.abs(a - e) <= 2000;
  // Unbekanntes Format: unter Windows (kein ps-Format) zählt die PID, sonst lieber "nicht aktiv".
  return process.platform === 'win32';
}

/**
 * Programme, die zwischen aufrufendem Agenten und gestartetem claude liegen dürfen
 * (Bash-Tool → Shell → evtl. Wrapper → claude). Alles andere – etwa der Daemon,
 * der Hintergrund-Jobs forkt – ist keine Aufrufbeziehung.
 */
const LAUNCH_INTERMEDIATES = new Set([
  'sh', 'zsh', 'bash', 'dash', 'fish', '-zsh', '-bash', 'env', 'caffeinate', 'timeout', 'gtimeout', 'nohup', 'time', 'script', 'xargs', 'stdbuf', 'nice', 'sudo',
  // Windows (Namen ohne .exe)
  'cmd', 'powershell', 'pwsh',
]);


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
  if (decoded.length === 0) return decoded;
  let running: Map<number, string>;
  let table: Map<number, ProcRow>;
  if (process.platform === 'win32') {
    table = await cachedWindowsTable();
    running = new Map([...table].map(([pid, r]) => [pid, r.start ?? '']));
  } else {
    [running, table] = await Promise.all([procStarts(decoded.map((p) => p.pid).filter((p) => p > 0)), unixTable()]);
  }
  for (const p of decoded) p.alive = sameProcess(running.get(p.pid), procStart.get(p.pid));
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
