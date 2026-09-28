#!/usr/bin/env node
/**
 * claude-inspect command line.
 *
 *   claude-inspect [--port 7717] [--open] [--token T | --no-auth]   start the dashboard
 *   claude-inspect service install|uninstall|status [--port 47717]   autostart (macOS/Linux)
 *   claude-inspect demo [--port 7718] [--out DIR]                    run on fictional demo data
 *
 * Everything is imported lazily: the demo must set CLAUDE_CONFIG_DIR before config.ts is loaded.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const env = process.env;

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, '..', '..', 'package.json'), join(here, '..', '..', '..', 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8'));
      if (pkg.name === 'claude-inspect') return pkg.version;
    } catch {
      /* next candidate */
    }
  }
  return '?';
}

const HELP = `claude-inspect ${version()} – live dashboard & history viewer for Claude Code agents

Usage:
  claude-inspect [options]                 start the dashboard (reads ~/.claude)
  claude-inspect service install           start automatically at login (port 47717, no token)
  claude-inspect service uninstall|status
  claude-inspect demo                      try it on fictional demo data

Options:
  --port <n>       port (default 7717; service 47717; demo 7718)   env: CLAUDE_INSPECT_PORT
  --open           open the browser
  --token <t>      fixed access token instead of a random one      env: CLAUDE_INSPECT_TOKEN
  --no-auth        no token (still only reachable from localhost)  env: CLAUDE_INSPECT_NO_AUTH=1
  --out <dir>      demo: only write the demo data to <dir>
  -v, --version    print the version
  -h, --help       show this help

Data directory: $CLAUDE_CONFIG_DIR or ~/.claude`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string' },
    open: { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
    token: { type: 'string', default: env.CLAUDE_INSPECT_TOKEN },
    'no-auth': { type: 'boolean', default: env.CLAUDE_INSPECT_NO_AUTH === '1' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
});

const [cmd, sub] = positionals;
const port = (fallback: number) => Number(values.port ?? env.CLAUDE_INSPECT_PORT ?? fallback);

if (values.help) {
  console.log(HELP);
} else if (values.version) {
  console.log(version());
} else if (cmd === 'service') {
  const { service } = await import('./cli/service.js');
  service(sub ?? 'status', Number(values.port ?? 47717));
} else if (cmd === 'demo') {
  const { runDemo } = await import('./cli/demo.js');
  await runDemo({ out: values.out, port: port(7718), open: values.open });
} else if (cmd === undefined) {
  const { runServer } = await import('./run.js');
  await runServer({ port: port(7717), open: values.open, dev: values.dev, noAuth: values['no-auth'], token: values.token });
} else {
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exit(1);
}
