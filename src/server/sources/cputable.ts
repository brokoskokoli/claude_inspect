import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

/** Ein Prozess mit seiner bisher verbrauchten CPU-Zeit (user + system). */
export interface CpuProc {
  pid: number;
  ppid: number;
  /** Programmname ohne Pfad */
  comm: string;
  /** CPU-Zeit seit Prozessstart in ms */
  cpuMs: number;
}

/**
 * `ps time` → ms. macOS: "MMM:SS.ss" (Minuten über 60 möglich), Linux/BSD: "[DD-]HH:MM:SS".
 * Von rechts gelesen: Sekunden, Minuten, Stunden; davor optional Tage.
 */
export function parsePsTime(s: string): number | undefined {
  const m = /^(?:(\d+)-)?([\d:.]+)$/.exec(s.trim());
  if (!m) return undefined;
  const parts = m[2].split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n)) || parts.length > 3) return undefined;
  const [sec, min = 0, hour = 0] = parts.reverse();
  return Math.round(((Number(m[1] ?? 0) * 24 + hour) * 3600 + min * 60 + sec) * 1000);
}

/** Zeilen von `ps -A -o pid=,ppid=,time=,comm=`. */
export function parsePsTable(stdout: string): Map<number, CpuProc> {
  const out = new Map<number, CpuProc>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const cpuMs = parsePsTime(m[3]);
    if (cpuMs === undefined) continue;
    out.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), cpuMs, comm: m[4].trim().split('/').pop() ?? '' });
  }
  return out;
}

/** Linux: Taktrate der Werte in /proc/<pid>/stat. Praktisch überall 100. */
const CLK_TCK = 100;

/** Eine `/proc/<pid>/stat`-Zeile. Der Programmname steht in Klammern und darf selbst Klammern enthalten. */
export function parseProcStat(line: string): CpuProc | undefined {
  const open = line.indexOf('(');
  const close = line.lastIndexOf(')');
  if (open < 0 || close < open) return undefined;
  const pid = Number(line.slice(0, open).trim());
  // Felder nach dem Namen: state(3) ppid(4) … utime(14) stime(15)
  const f = line.slice(close + 2).split(' ');
  const ppid = Number(f[1]);
  const ticks = Number(f[11]) + Number(f[12]);
  if (!pid || Number.isNaN(ppid) || Number.isNaN(ticks)) return undefined;
  return { pid, ppid, comm: line.slice(open + 1, close), cpuMs: (ticks * 1000) / CLK_TCK };
}

function unixTable(): Promise<Map<number, CpuProc>> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,time=,comm='], { env: { ...process.env, LC_ALL: 'C' }, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) =>
      resolve(parsePsTable(String(stdout ?? ''))),
    );
  });
}

/** Linux liefert über `ps time` nur ganze Sekunden – zu grob für Abstände von 3 s, daher /proc. */
async function linuxTable(): Promise<Map<number, CpuProc>> {
  const out = new Map<number, CpuProc>();
  let names: string[] = [];
  try {
    names = await readdir('/proc');
  } catch {
    return unixTable();
  }
  await Promise.all(
    names
      .filter((n) => /^\d+$/.test(n))
      .map(async (n) => {
        try {
          const p = parseProcStat(await readFile(`/proc/${n}/stat`, 'utf8'));
          if (p) out.set(p.pid, p);
        } catch {
          /* inzwischen beendet */
        }
      }),
  );
  return out;
}

/** Windows: Kernel- und User-Zeit in 100-ns-Einheiten (rein lesend). */
const WIN_PS =
  "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, " +
  '([uint64]$_.KernelModeTime + [uint64]$_.UserModeTime), $_.Name }';

function windowsTable(): Promise<Map<number, CpuProc>> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PS], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (_err, stdout) => {
      const out = new Map<number, CpuProc>();
      for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const m = /^(\d+) (\d+) (\d+) (.*)$/.exec(line.trim());
        if (m) out.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), cpuMs: Number(m[3]) / 10_000, comm: m[4].toLowerCase().replace(/\.exe$/, '') });
      }
      resolve(out);
    });
  });
}

/** Alle Prozesse mit Eltern-PID und verbrauchter CPU-Zeit. */
export function readCpuTable(): Promise<Map<number, CpuProc>> {
  if (process.platform === 'win32') return windowsTable();
  if (process.platform === 'linux') return linuxTable();
  return unixTable();
}
