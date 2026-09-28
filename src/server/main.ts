import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CLAUDE_DIR } from './config.js';
import { startServer } from './http.js';
import { Inspector } from './inspector.js';

const env = process.env;
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: env.CLAUDE_INSPECT_PORT ?? '7717' },
    dev: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    // Fixed access token so bookmarks survive restarts (otherwise random per start)
    token: { type: 'string', default: env.CLAUDE_INSPECT_TOKEN },
    // No token at all. The server still only listens on 127.0.0.1 and checks the Host header.
    'no-auth': { type: 'boolean', default: env.CLAUDE_INSPECT_NO_AUTH === '1' },
  },
});

// Works from src/server (tsx) as well as from the compiled dist/app/server.
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = [join(here, '..', '..', 'dist', 'web'), join(here, '..', '..', 'web')].find((d) => existsSync(join(d, 'index.html'))) ?? join(here, '..', '..', 'dist', 'web');

const inspector = new Inspector();
const t0 = Date.now();
await inspector.start();

const port = Number(values.port);
const noAuth = values.dev || values['no-auth'];
const { token } = startServer(inspector, { port, host: '127.0.0.1', webRoot, noAuth, token: values.token });

const url = noAuth ? `http://localhost:${port}/` : `http://localhost:${port}/?t=${token}`;
console.log(`claude-inspect is reading ${CLAUDE_DIR} (started in ${Date.now() - t0} ms)`);
console.log(values.dev ? `API (dev, no token): ${url}  –  UI: npm run dev:web` : `Dashboard: ${url}`);
if (values.open && process.platform === 'darwin') execFile('open', [url]);
else if (values.open && process.platform === 'linux') execFile('xdg-open', [url]);

const shutdown = () => {
  inspector.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
