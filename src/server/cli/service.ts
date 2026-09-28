/**
 * Autostart for claude-inspect (runs the compiled build with plain node).
 *
 *   claude-inspect service install [--port 47717]   install + start (login autostart, restart on crash)
 *   claude-inspect service uninstall                  stop + remove
 *   claude-inspect service status                     show state and URL
 *
 * macOS: LaunchAgent in ~/Library/LaunchAgents, log in ~/Library/Logs/claude-inspect.log
 * Linux: systemd user unit in ~/.config/systemd/user, log via `journalctl --user -u claude-inspect`
 *
 * The service runs without access token (--no-auth): it only listens on 127.0.0.1 and
 * rejects requests with a foreign Host header, so a plain bookmark to http://localhost:<port> works.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * The service always runs the compiled cli.js: next to this file in a build/npm install
 * (…/dist/app/server/cli), or the project's dist when started from the sources via tsx.
 */
const FROM_SOURCES = HERE.split(sep).slice(-3).join('/') === 'src/server/cli';
const ROOT = FROM_SOURCES ? resolve(HERE, '..', '..', '..') : resolve(HERE, '..', '..', '..', '..');
const ENTRY = FROM_SOURCES ? join(ROOT, 'dist', 'app', 'server', 'cli.js') : resolve(HERE, '..', 'cli.js');
const WEB = FROM_SOURCES ? join(ROOT, 'dist', 'web') : resolve(HERE, '..', '..', '..', 'web');
const LABEL = 'com.github.claude-inspect';
let port = 47717;
let URL = `http://localhost:${port}/`;

function run(bin: string, args: string[], quiet = false): string {
  try {
    return execFileSync(bin, args, { stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] }).toString();
  } catch (e) {
    if (quiet) return '';
    throw e;
  }
}

/** Stable node path (e.g. /opt/homebrew/bin/node instead of a versioned Cellar path). */
function nodePath(): string {
  const found = run('sh', ['-c', 'command -v node'], true).trim();
  return found || process.execPath;
}

function requireBuild(): void {
  if (!existsSync(ENTRY) || !existsSync(join(WEB, 'index.html'))) {
    console.error(`No build found at ${ENTRY} – run \`npm run build\` first.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// macOS (launchd)

const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logPath = join(homedir(), 'Library', 'Logs', 'claude-inspect.log');
const domain = `gui/${userInfo().uid}`;

function macInstall(): void {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const args = [nodePath(), ENTRY, '--port', String(port), '--no-auth'];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(logPath)}</string>
  <key>StandardErrorPath</key><string>${esc(logPath)}</string>
</dict>
</plist>
`;
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(dirname(logPath), { recursive: true });
  run('launchctl', ['bootout', `${domain}/${LABEL}`], true); // replace an older install
  writeFileSync(plistPath, plist);
  // bootout finishes asynchronously; bootstrap fails with "Input/output error" until it has.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'pipe' });
      break;
    } catch (e) {
      if (attempt >= 10) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  console.log(`Installed LaunchAgent ${plistPath}\nLog: ${logPath}`);
}

function macUninstall(): void {
  run('launchctl', ['bootout', `${domain}/${LABEL}`], true);
  rmSync(plistPath, { force: true });
  console.log('LaunchAgent removed.');
}

function macStatus(): void {
  const out = run('launchctl', ['print', `${domain}/${LABEL}`], true);
  if (!out) return console.log('Not installed.');
  const state = /state = (\w+)/.exec(out)?.[1] ?? '?';
  const pid = /pid = (\d+)/.exec(out)?.[1];
  console.log(`State: ${state}${pid ? ` (pid ${pid})` : ''}\nPlist: ${plistPath}\nLog:   ${logPath}`);
}

// ---------------------------------------------------------------------------
// Linux (systemd --user)

const unitPath = join(homedir(), '.config', 'systemd', 'user', 'claude-inspect.service');

function linuxInstall(): void {
  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(
    unitPath,
    `[Unit]
Description=claude-inspect – live dashboard for Claude Code agents

[Service]
ExecStart=${nodePath()} ${ENTRY} --port ${port} --no-auth
WorkingDirectory=${ROOT}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`,
  );
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', 'claude-inspect.service']);
  console.log(`Installed ${unitPath}\nLog: journalctl --user -u claude-inspect`);
}

function linuxUninstall(): void {
  run('systemctl', ['--user', 'disable', '--now', 'claude-inspect.service'], true);
  rmSync(unitPath, { force: true });
  run('systemctl', ['--user', 'daemon-reload'], true);
  console.log('Service removed.');
}

function linuxStatus(): void {
  console.log(run('systemctl', ['--user', 'status', 'claude-inspect.service', '--no-pager'], true) || 'Not installed.');
}

// ---------------------------------------------------------------------------

export function service(cmd: string, servicePort: number): void {
  port = servicePort;
  URL = `http://localhost:${port}/`;
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'linux') {
    console.error('Autostart is only supported on macOS and Linux.');
    process.exit(1);
  }
  switch (cmd) {
    case 'install':
      requireBuild();
      (mac ? macInstall : linuxInstall)();
      console.log(`\nDashboard: ${URL}  (bookmark it – no token needed)`);
      break;
    case 'uninstall':
      (mac ? macUninstall : linuxUninstall)();
      break;
    case 'status':
      (mac ? macStatus : linuxStatus)();
      console.log(`URL:   ${URL}`);
      break;
    default:
      console.error('Usage: claude-inspect service install|uninstall|status [--port 47717]');
      process.exit(1);
  }
}
