import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CLAUDE_DIR } from './config.js';
import { startServer } from './http.js';
import { Inspector } from './inspector.js';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '7717' },
    dev: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    // fester Zugangsschlüssel, damit Lesezeichen einen Neustart überleben (sonst zufällig)
    token: { type: 'string', default: process.env.CLAUDE_INSPECT_TOKEN },
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const inspector = new Inspector();
const t0 = Date.now();
await inspector.start();

const port = Number(values.port);
const { token } = startServer(inspector, {
  port,
  host: '127.0.0.1',
  webRoot: join(root, 'dist', 'web'),
  noAuth: values.dev,
  token: values.token,
});

const url = values.dev ? `http://127.0.0.1:${port}/` : `http://127.0.0.1:${port}/?t=${token}`;
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
