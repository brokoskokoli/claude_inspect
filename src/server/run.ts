import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_DIR } from './config.js';
import { startServer } from './http.js';
import { Inspector } from './inspector.js';

export interface RunOptions {
  port: number;
  open?: boolean;
  /** API without token, intended for the Vite dev server proxy */
  dev?: boolean;
  /** no access token (still 127.0.0.1 only + Host header check) */
  noAuth?: boolean;
  /** fixed access token; random per start if omitted */
  token?: string;
}

/** Locates the built web UI – works from src/server (tsx), dist/app/server and an installed npm package. */
function findWebRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', '..', 'dist', 'web'), join(here, '..', '..', 'web')];
  return candidates.find((d) => existsSync(join(d, 'index.html'))) ?? candidates[0];
}

function openBrowser(url: string): void {
  const [bin, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]] // kein cmd/start: "&" in der URL wäre dort ein Befehlstrenner
        : ['xdg-open', [url]];
  execFile(bin, args, () => undefined).on('error', () => undefined);
}

export async function runServer(opts: RunOptions): Promise<void> {
  const inspector = new Inspector();
  const t0 = Date.now();
  await inspector.start();

  const noAuth = !!(opts.dev || opts.noAuth);
  const { server, token } = startServer(inspector, { port: opts.port, host: '127.0.0.1', webRoot: findWebRoot(), noAuth, token: opts.token });
  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${opts.port} is already in use – choose another one with --port.` : String(e));
    process.exit(1);
  });

  const url = noAuth ? `http://localhost:${opts.port}/` : `http://localhost:${opts.port}/?t=${token}`;
  console.log(`claude-inspect is reading ${CLAUDE_DIR} (started in ${Date.now() - t0} ms)`);
  console.log(opts.dev ? `API (dev, no token): ${url}  –  UI: npm run dev:web` : `Dashboard: ${url}`);
  if (opts.open) openBrowser(url);

  const shutdown = () => {
    inspector.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
