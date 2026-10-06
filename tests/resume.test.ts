import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resumeCommands } from '../src/shared/resume.js';

const id = '7fccd176-dafe-40e3-b646-96e4d987b75b';

test('ended session: resume first, fork second, in its directory', () => {
  const [r, f] = resumeCommands({ sessionId: id, cwd: '/Users/me/my repo', platform: 'darwin', live: false });
  assert.equal(r.kind, 'resume');
  assert.equal(r.command, `cd '/Users/me/my repo' && claude --resume ${id}`);
  assert.equal(f.command, `cd '/Users/me/my repo' && claude --resume ${id} --fork-session`);
});

test('still open elsewhere: only fork', () => {
  const cmds = resumeCommands({ sessionId: id, cwd: '/r', platform: 'linux', live: true });
  assert.deepEqual(cmds.map((c) => c.kind), ['fork']);
});

test('background session: attach by short id', () => {
  const [a] = resumeCommands({ sessionId: id, cwd: '/r', platform: 'darwin', live: true, processKind: 'bg', jobShort: '014329fb' });
  assert.equal(a.command, 'claude attach 014329fb');
});

test('quoting: single quotes in POSIX paths, PowerShell on Windows', () => {
  assert.equal(resumeCommands({ sessionId: id, cwd: "/tmp/it's", platform: 'darwin', live: false })[0].command, `cd '/tmp/it'\\''s' && claude --resume ${id}`);
  assert.equal(
    resumeCommands({ sessionId: id, cwd: "C:\\Users\\me\\it's", platform: 'win32', live: false })[0].command,
    `Set-Location -LiteralPath 'C:\\Users\\me\\it''s'; claude --resume ${id}`,
  );
});

test('the directory part really works in this OS shell (sh / PowerShell)', () => {
  // Ordnername mit Leerzeichen, Apostroph, Klammern und $ – alles, was Quoting kaputt machen kann
  const root = mkdtempSync(join(tmpdir(), 'ci-resume-'));
  const dir = join(root, "my repo [it's] $HOME");
  mkdirSync(dir);
  try {
    const win = process.platform === 'win32';
    const cmd = resumeCommands({ sessionId: id, cwd: dir, platform: process.platform, live: false })[0].command;
    // statt claude zu starten: aktuelles Verzeichnis ausgeben
    const probe = cmd.replace(/claude --resume .*$/, win ? '(Get-Location).ProviderPath' : 'pwd -P');
    const out = win
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', probe]).toString()
      : execFileSync('sh', ['-c', probe]).toString();
    // Windows: Groß-/Kleinschreibung egal, Temp liegt evtl. unter einem 8.3-Kurznamen (RUNNER~1)
    const norm = (p: string) => (win ? p.toLowerCase() : p);
    assert.ok([dir, realpathSync(dir), realpathSync.native(dir)].map(norm).includes(norm(out.trim())), `${out.trim()} ≠ ${dir}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
