import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { ReviewRequest } from '../shared/review.js';
import type { StreamEvent } from '../shared/types.js';
import type { Inspector } from './inspector.js';
import { sanitize } from './util/sanitize.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

export interface ServerOptions {
  port: number;
  host: string;
  webRoot: string;
  /** Ohne Token (für `npm run dev` mit Vite-Proxy). */
  noAuth: boolean;
  /** Fester Zugangsschlüssel; ohne Angabe wird bei jedem Start ein zufälliger erzeugt. */
  token?: string;
}

export function startServer(inspector: Inspector, opts: ServerOptions) {
  const token = opts.token || randomBytes(18).toString('base64url');
  const COOKIE = 'ci_token';

  const authed = (req: IncomingMessage, url: URL): boolean => {
    if (opts.noAuth) return true;
    const given = url.searchParams.get('t') ?? /(?:^|;\s*)ci_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  // Schutz gegen DNS-Rebinding: nur lokale Host-Header akzeptieren.
  const hostOk = (req: IncomingMessage): boolean => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const sseClients = new Set<ServerResponse>();
  inspector.on('event', (ev: StreamEvent) => {
    const msg = `event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`;
    for (const c of sseClients) c.write(msg);
  });
  setInterval(() => {
    for (const c of sseClients) c.write(': ping\n\n');
  }, 20_000).unref();

  async function serveStatic(res: ServerResponse, pathname: string) {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(opts.webRoot, rel);
    if (!file.startsWith(opts.webRoot)) return json(res, 403, { error: 'forbidden' });
    try {
      if (!(await stat(file)).isFile()) throw new Error();
    } catch {
      file = join(opts.webRoot, 'index.html'); // SPA-Fallback
    }
    try {
      await stat(file);
    } catch {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('UI not built. Run `npm run build` first (or `npm run dev:web` for development).');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }

  /**
   * Die einzigen schreibenden Aufrufe: Analyse starten/abbrechen. Nur mit JSON-Body (erzwingt bei
   * fremden Seiten einen CORS-Preflight, den der Server nie erlaubt) und lokalem Origin.
   */
  async function post(req: IncomingMessage, res: ServerResponse, p: string) {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return json(res, 403, { error: 'origin not allowed' });
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON expected' });
    let raw = '';
    for await (const c of req) {
      raw += c;
      if (raw.length > 100_000) return json(res, 413, { error: 'too large' });
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: 'invalid JSON' });
    }
    let m = /^\/api\/review\/([\w-]+)$/.exec(p);
    if (m) {
      try {
        return json(res, 200, await inspector.startReview(m[1], body as unknown as ReviewRequest));
      } catch (e) {
        return json(res, 400, { error: (e as Error).message });
      }
    }
    m = /^\/api\/review-cancel\/([\w-]+)$/.exec(p);
    if (m) return json(res, 200, { cancelled: inspector.reviewer?.cancel(m[1]) ?? false });
    return json(res, 405, { error: 'read-only' });
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!hostOk(req)) return json(res, 403, { error: 'host not allowed' });
      if (!authed(req, url)) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Not authorized – open the URL with ?t=… printed in the console.');
      }
      // Token aus der URL in ein Cookie übernehmen, damit Folgeaufrufe ohne ?t= funktionieren.
      if (!opts.noAuth && url.searchParams.has('t')) {
        // persistent for a year, so a bookmark without ?t= keeps working after browser restarts
        res.setHeader('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
      }

      const p = url.pathname;
      if (req.method === 'POST') return await post(req, res, p);
      if (req.method !== 'GET') return json(res, 405, { error: 'read-only' });

      if (p === '/api/dashboard') return json(res, 200, await inspector.getDashboard());

      if (p === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: dashboard\ndata: ${JSON.stringify(await inspector.getDashboard())}\n\n`);
        res.write(`event: cpu\ndata: ${JSON.stringify(inspector.cpuSnapshot())}\n\n`);
        sseClients.add(res);
        inspector.setViewers(sseClients.size);
        req.on('close', () => {
          sseClients.delete(res);
          inspector.setViewers(sseClients.size);
        });
        return;
      }

      if (p === '/api/sessions') {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 500);
        return json(res, 200, await inspector.sessions(offset, limit, url.searchParams.get('q') ?? undefined));
      }

      let m = /^\/api\/session\/([\w-]+)$/.exec(p);
      if (m) {
        const d = await inspector.sessionDetail(m[1]);
        return d ? json(res, 200, d) : json(res, 404, { error: 'unknown session' });
      }

      m = /^\/api\/transcript\/([\w-]+)$/.exec(p);
      if (m) {
        const agent = url.searchParams.get('agent') || undefined;
        const from = Number(url.searchParams.get('from') ?? 0);
        const page = await inspector.transcript(m[1], agent, from);
        return page ? json(res, 200, page) : json(res, 404, { error: 'unknown transcript' });
      }

      m = /^\/api\/raw\/([\w-]+)$/.exec(p);
      if (m) {
        const agent = url.searchParams.get('agent') || undefined;
        const line = await inspector.rawLine(m[1], agent, Number(url.searchParams.get('line')));
        if (line === undefined) return json(res, 404, { error: 'unknown line' });
        try {
          // Auch in der Rohansicht Geheimnisse maskieren, aber nichts kürzen.
          return json(res, 200, sanitize(JSON.parse(line), { maxString: Number.MAX_SAFE_INTEGER }));
        } catch {
          return json(res, 200, { unparsable: line });
        }
      }

      if (p === '/api/formats') return json(res, 200, inspector.formats());

      // --- History (Phase 4) ---
      const sp = url.searchParams;
      const filter = {
        project: sp.get('project') || undefined,
        days: sp.get('days') ? Number(sp.get('days')) : undefined,
      };
      if (p === '/api/stats') return json(res, 200, await inspector.historyStats(filter));
      if (p === '/api/projects') return json(res, 200, await inspector.historyProjects());
      if (p === '/api/tools') {
        return json(
          res,
          200,
          await inspector.toolCalls({
            ...filter,
            name: sp.get('name') || undefined,
            q: sp.get('q') || undefined,
            sessionId: sp.get('session') || undefined,
            file: sp.get('file') || undefined,
            errorsOnly: sp.get('errors') === '1',
            offset: Number(sp.get('offset') ?? 0),
            limit: Math.min(Number(sp.get('limit') ?? 100), 1000),
          }),
        );
      }
      if (p === '/api/files') return json(res, 200, await inspector.fileStats({ ...filter, q: sp.get('q') || undefined }));
      if (p === '/api/search') return json(res, 200, await inspector.search(sp.get('q') ?? ''));

      m = /^\/api\/cpu\/([\w-]+)$/.exec(p);
      if (m) return json(res, 200, await inspector.cpuHistory(m[1]));

      m = /^\/api\/cost\/([\w-]+)$/.exec(p);
      if (m) {
        const cost = await inspector.sessionCost(m[1]);
        return cost ? json(res, 200, cost) : json(res, 404, { error: 'unknown session' });
      }

      m = /^\/api\/review\/([\w-]+)$/.exec(p);
      if (m) {
        const st = await inspector.reviewState(m[1]);
        return st ? json(res, 200, st) : json(res, 404, { error: 'unknown session' });
      }
      m = /^\/api\/review\/([\w-]+)\/digest$/.exec(p);
      if (m) {
        const d = await inspector.reviewDigest(m[1]);
        if (!d) return json(res, 404, { error: 'unknown session' });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(d.text);
      }

      m = /^\/api\/flow\/([\w-]+)$/.exec(p);
      if (m) {
        const flow = await inspector.flow(m[1]);
        return flow ? json(res, 200, flow) : json(res, 404, { error: 'unknown session' });
      }

      if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      return serveStatic(res, p);
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });

  server.listen(opts.port, opts.host);
  return { server, token };
}
