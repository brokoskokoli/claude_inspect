import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { quotePath } from '../shared/resume.js';

/**
 * Startet `claude` in einem neuen Fenster des Standard-Terminals, im Arbeitsverzeichnis der
 * Session. Der Befehl kommt als kleines Skript in das eigene Datenverzeichnis, das sich beim
 * Start selbst löscht – so gibt es kein Quoting über mehrere Programme hinweg.
 *
 * - macOS: `open` auf eine .command-Datei → die App, die dafür eingestellt ist (Terminal, iTerm …).
 * - Linux: $TERMINAL, sonst x-terminal-emulator, gnome-terminal, konsole, … xterm.
 * - Windows: `start` mit PowerShell → das eingestellte Standard-Terminal (Windows Terminal oder Konsole).
 */

/** Linux-Terminals und wie man ihnen ein Programm übergibt */
const LINUX_TERMINALS: [string, string[]][] = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['kitty', []],
  ['alacritty', ['-e']],
  ['wezterm', ['start', '--']],
  ['foot', []],
  ['xterm', ['-e']],
];

async function onPath(name: string): Promise<string | undefined> {
  for (const d of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      await access(join(d, name), constants.X_OK);
      return join(d, name);
    } catch {
      /* weiter */
    }
  }
  return undefined;
}

function detached(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * @param claude Pfad zu claude (der Autostart-Dienst hat oft einen knappen PATH)
 * @param args   Argumente für claude
 * @param dir    Verzeichnis für das Startskript
 */
export async function openInTerminal(claude: string, args: string[], cwd: string, dir: string): Promise<void> {
  if (!(await stat(cwd)).isDirectory()) throw new Error(`not a directory: ${cwd}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const id = randomBytes(6).toString('hex');
  const platform = process.platform;

  if (platform === 'win32') {
    const file = join(dir, `claude-${id}.ps1`);
    const q = (s: string) => quotePath(s, 'win32');
    await writeFile(file, [`Remove-Item -LiteralPath $PSCommandPath`, `Set-Location -LiteralPath ${q(cwd)}`, `& ${[claude, ...args].map(q).join(' ')}`, ''].join('\r\n'));
    await detached('cmd.exe', ['/d', '/c', 'start', '', 'powershell.exe', '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], cwd);
    return;
  }

  const q = (s: string) => quotePath(s, platform);
  // Nach dem Ende von claude bleibt eine Shell im Ordner offen, statt dass das Fenster verschwindet
  const script = ['#!/bin/sh', 'rm -f "$0"', `cd ${q(cwd)} || exit 1`, `${[claude, ...args].map(q).join(' ')}`, 'exec "${SHELL:-/bin/sh}" -l', ''].join('\n');

  if (platform === 'darwin') {
    const file = join(dir, `claude-${id}.command`);
    await writeFile(file, script, { mode: 0o700 });
    await chmod(file, 0o700);
    await detached('/usr/bin/open', [file], cwd);
    return;
  }

  const file = join(dir, `claude-${id}.sh`);
  await writeFile(file, script, { mode: 0o700 });
  const own = process.env.TERMINAL ? [[process.env.TERMINAL, ['-e']] as [string, string[]]] : [];
  for (const [name, pre] of [...own, ...LINUX_TERMINALS]) {
    const bin = name.includes('/') ? name : await onPath(name);
    if (!bin) continue;
    await detached(bin, [...pre, '/bin/sh', file], cwd);
    return;
  }
  throw new Error('no terminal program found (set $TERMINAL)');
}
