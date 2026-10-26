export type SessionTab = 'transcript' | 'timeline' | 'graph' | 'tasks' | 'cpu' | 'cost' | 'analysis';

export type Route =
  | { name: 'dashboard' }
  | { name: 'sessions' }
  | { name: 'session'; id: string; agent?: string; tab: SessionTab; tool?: string; line?: number; from?: number; to?: number }
  | { name: 'stats' }
  | { name: 'tools'; params: URLSearchParams }
  | { name: 'files' }
  | { name: 'search'; q: string }
  | { name: 'formats' };

/** Session öffnet mit den Kosten; Links auf einen Subagenten, Tool-Aufruf oder eine Zeile zeigen das Transcript. */
function defaultTab(agent?: string, tool?: string, line?: string | number | null): SessionTab {
  return agent || tool || (line !== undefined && line !== null) ? 'transcript' : 'cost';
}

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
    const agent = params.get('agent') ?? undefined;
    const tool = params.get('tool') ?? undefined;
    return {
      name: 'session',
      id: parts[1],
      agent,
      tab: (params.get('tab') as SessionTab) ?? defaultTab(agent, tool, line),
      tool: params.get('tool') ?? undefined,
      line: line ? Number(line) : undefined,
      // Zeitfenster (ms), das die Zeitleiste hervorhebt
      from: params.get('from') ? Number(params.get('from')) : undefined,
      to: params.get('to') ? Number(params.get('to')) : undefined,
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
  session: (id: string, agent?: string, extra: { tab?: SessionTab; tool?: string; line?: number; from?: number; to?: number } = {}) => {
    const q = new URLSearchParams();
    if (agent) q.set('agent', agent);
    if (extra.tab && extra.tab !== defaultTab(agent, extra.tool, extra.line)) q.set('tab', extra.tab);
    if (extra.tool) q.set('tool', extra.tool);
    if (extra.line !== undefined) q.set('line', String(extra.line));
    if (extra.from !== undefined && extra.to !== undefined) q.set('from', String(extra.from)), q.set('to', String(extra.to));
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
