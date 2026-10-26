/**
 * Terminal-Befehle zum Fortsetzen einer Session: als Text zum Kopieren und als Argumente,
 * mit denen der Server sie auf Knopfdruck in einem neuen Terminalfenster startet.
 */

export interface ResumeCommand {
  kind: 'attach' | 'resume' | 'fork';
  /** Button-Beschriftung */
  label: string;
  command: string;
  /** Argumente für `claude` (ohne das Programm selbst) */
  args: string[];
  /** Arbeitsverzeichnis, in dem der Befehl laufen muss */
  cwd?: string;
  /** Was der Befehl tut, für den Tooltip/Hinweis */
  hint: string;
}

export interface ResumeInput {
  sessionId: string;
  cwd?: string;
  /** process.platform des Servers – bestimmt Quoting und Befehlstrenner */
  platform: string;
  /** Ein claude-Prozess dieser Session läuft noch. */
  live: boolean;
  /** Prozess-Art laut Session-Datei ("bg" = Hintergrund-Session des Daemons) */
  processKind?: string;
  /** Kurz-Id des Hintergrund-Jobs (`claude attach <short>`) */
  jobShort?: string;
  /** zuletzt gültiger Berechtigungsmodus der Session (z. B. "bypassPermissions") */
  permissionMode?: string;
  /** Agent-Definition, mit der die Session lief (`--agent`) */
  agent?: string;
}

/** Modi, die `claude --permission-mode` annimmt; "default" braucht keine Option. */
const PERMISSION_MODES = new Set(['acceptEdits', 'auto', 'dontAsk', 'manual', 'plan']);

/**
 * Optionen, mit denen die Session lief, soweit sie in den Transcripts stehen. Modell und
 * Effort fehlen absichtlich: Sie kommen aus den Einstellungen, und das Transcript nennt das
 * Modell ohne Zusätze wie "[1m]" – eine Angabe würde die Session also eher verstellen.
 */
export function launchFlags(s: Pick<ResumeInput, 'permissionMode' | 'agent'>): string[] {
  const out: string[] = [];
  if (s.permissionMode === 'bypassPermissions') out.push('--dangerously-skip-permissions');
  else if (s.permissionMode && PERMISSION_MODES.has(s.permissionMode)) out.push('--permission-mode', s.permissionMode);
  // Agent-Namen sind Dateinamen; alles andere wäre kein gültiger Name und wird weggelassen
  if (s.agent && /^[\w.:-]+$/.test(s.agent)) out.push('--agent', s.agent);
  return out;
}

/** Ein Argument für die Shell; harmlose bleiben unverändert lesbar. */
function quoteArg(a: string, platform: string): string {
  return /^[\w.:\/=-]+$/.test(a) ? a : quotePath(a, platform);
}

/** Pfad als ein Shell-Argument: POSIX in '…', PowerShell in '…' mit verdoppeltem '. */
export function quotePath(path: string, platform: string): string {
  return platform === 'win32' ? `'${path.replace(/'/g, "''")}'` : `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * Windows: PowerShell (Standard in Windows Terminal). -LiteralPath, weil `cd` dort "[" und "]"
 * als Platzhalter liest; ";" statt "&&", das Windows PowerShell 5.1 nicht kennt.
 */
function inDir(cwd: string | undefined, cmd: string, platform: string): string {
  if (!cwd) return cmd;
  if (platform === 'win32') return `Set-Location -LiteralPath ${quotePath(cwd, platform)}; ${cmd}`;
  return `cd ${quotePath(cwd, platform)} && ${cmd}`;
}

/** Passende Befehle, der empfohlene zuerst. Leer, wenn es nichts fortzusetzen gibt. */
export function resumeCommands(s: ResumeInput): ResumeCommand[] {
  const flags = launchFlags(s);
  const make = (kind: ResumeCommand['kind'], label: string, args: string[], hint: string, cwd: string | undefined): ResumeCommand => ({
    kind,
    label,
    args,
    cwd,
    command: inDir(cwd, ['claude', ...args].map((a) => quoteArg(a, s.platform)).join(' '), s.platform),
    hint,
  });
  const optionHint = flags.length ? ` with the options it ran with (${flags.join(' ')})` : '';
  const resume = make('resume', 'Resume', ['--resume', s.sessionId, ...flags], `Continues this conversation where it left off${optionHint}`, s.cwd);
  const fork = make('fork', 'Fork', ['--resume', s.sessionId, '--fork-session', ...flags], `Starts a copy with the full history under a new session id – the original stays untouched${optionHint}`, s.cwd);

  // Hintergrund-Session: attach holt sie ins Terminal, auch wenn sie gestoppt ist.
  if (s.jobShort && (s.processKind === 'bg' || !s.live)) {
    return [
      make('attach', 'Attach', ['attach', s.jobShort], 'Opens the background session in a terminal', undefined),
      fork,
    ];
  }
  // Noch offen in einem anderen Fenster: zweimal dieselbe Session zu schreiben, verwirrt beide.
  if (s.live) return [{ ...fork, hint: `${fork.hint}. The session itself is still open in another window.` }];
  return [resume, fork];
}
