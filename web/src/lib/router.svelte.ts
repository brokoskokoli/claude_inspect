export type SessionTab = 'verlauf' | 'zeitleiste' | 'graph' | 'tasks';

export type Route =
  | { name: 'dashboard' }
  | { name: 'sessions' }
  | { name: 'session'; id: string; agent?: string; tab: SessionTab; tool?: string; line?: number }
  | { name: 'stats' }
  | { name: 'tools'; params: URLSearchParams }
  | { name: 'files' }
  | { name: 'search'; q: string }
  | { name: 'formats' };

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'sessions') return { name: 'sessions' };
  if (parts[0] === 'formats') return { name: 'formats' };
  if (parts[0] === 'stats') return { name: 'stats' };
  if (parts[0] === 'tools') return { name: 'tools', params };
  if (parts[0] === 'files') return { name: 'files' };
  if (parts[0] === 'search') return { name: 'search', q: params.get('q') ?? '' };
  if (parts[0] === 'session' && parts[1]) {
    const line = params.get('line');
    return {
      name: 'session',
      id: parts[1],
      agent: params.get('agent') ?? undefined,
      tab: (params.get('tab') as SessionTab) ?? 'verlauf',
      tool: params.get('tool') ?? undefined,
      line: line ? Number(line) : undefined,
    };
  }
  return { name: 'dashboard' };
}

export const router = $state<{ route: Route }>({ route: parse(location.hash) });
window.addEventListener('hashchange', () => (router.route = parse(location.hash)));

export const href = {
  dashboard: () => '#/',
  sessions: () => '#/sessions',
  formats: () => '#/formats',
  session: (id: string, agent?: string, extra: { tab?: SessionTab; tool?: string; line?: number } = {}) => {
    const q = new URLSearchParams();
    if (agent) q.set('agent', agent);
    if (extra.tab && extra.tab !== 'verlauf') q.set('tab', extra.tab);
    if (extra.tool) q.set('tool', extra.tool);
    if (extra.line !== undefined) q.set('line', String(extra.line));
    const qs = q.toString();
    return `#/session/${id}${qs ? `?${qs}` : ''}`;
  },
  stats: () => '#/stats',
  tools: (params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    const qs = q.toString();
    return `#/tools${qs ? `?${qs}` : ''}`;
  },
  files: () => '#/files',
  search: (q = '') => `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
};
