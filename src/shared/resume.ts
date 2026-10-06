/**
 * Terminal-Befehle zum Fortsetzen einer Session. Nur Text zum Kopieren – das Dashboard
 * startet selbst nie Prozesse.
 */

export interface ResumeCommand {
  kind: 'attach' | 'resume' | 'fork';
  /** Button-Beschriftung */
  label: string;
  command: string;
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
  const resume: ResumeCommand = {
    kind: 'resume',
    label: 'Resume',
    command: inDir(s.cwd, `claude --resume ${s.sessionId}`, s.platform),
    hint: 'Continues this conversation where it left off',
  };
  const fork: ResumeCommand = {
    kind: 'fork',
    label: 'Fork',
    command: inDir(s.cwd, `claude --resume ${s.sessionId} --fork-session`, s.platform),
    hint: 'Starts a copy with the full history under a new session id – the original stays untouched',
  };

  // Hintergrund-Session: attach holt sie ins Terminal, auch wenn sie gestoppt ist.
  if (s.jobShort && (s.processKind === 'bg' || !s.live)) {
    return [
      {
        kind: 'attach',
        label: 'Attach',
        command: `claude attach ${s.jobShort}`,
        hint: 'Opens the background session in this terminal',
      },
      fork,
    ];
  }
  // Noch offen in einem anderen Fenster: zweimal dieselbe Session zu schreiben, verwirrt beide.
  if (s.live) return [{ ...fork, hint: `${fork.hint}. The session itself is still open in another window.` }];
  return [resume, fork];
}
