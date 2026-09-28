/**
 * Smoke test of the built CLI (dist/): generates demo data, starts the server on it and
 * checks UI and API. Runs in CI on macOS, Linux and Windows – `npm run build` first.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join('dist', 'app', 'server', 'cli.js');
const PORT = 7799;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'claude-inspect-smoke-'));

execFileSync(process.execPath, [CLI, 'demo', '--out', dir], { stdio: 'inherit' });
// A session file for this (running) process, without procStart: exercises the OS process table (ps / PowerShell).
mkdirSync(join(dir, 'sessions'), { recursive: true });
const now = Date.now();
writeFileSync(
  join(dir, 'sessions', `${process.pid}.json`),
  JSON.stringify({ pid: process.pid, sessionId: 'smoke', cwd: process.cwd(), startedAt: now, version: '2.1.283', peerProtocol: 1, kind: 'interactive', entrypoint: 'cli', updatedAt: now }),
);
const server = spawn(process.execPath, [CLI, '--port', String(PORT), '--no-auth'], {
  env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  stdio: 'inherit',
});

async function get(path: string): Promise<Response> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
}

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`smoke: ${msg}`);
  console.log(`✔ ${msg}`);
}

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(BASE + '/api/dashboard').then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  check(up, 'server answers');
  check((await (await get('/')).text()).includes('<html'), 'serves the web UI');
  const dash = await (await get('/api/dashboard')).json();
  const own = dash.processes.find((p: { process: { pid: number } }) => p.process.pid === process.pid);
  check(own?.process.alive === true, `detects the running process ${process.pid} as alive`);
  const sessions = await (await get('/api/sessions')).json();
  check(sessions.total > 0, `lists demo sessions (${sessions.total})`);
  const projects = await (await get('/api/projects')).json();
  check(projects.length > 0 && projects.every((p: { project: string }) => !/[\\/]/.test(p.project)), 'project names are plain folder names');
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
