import type {
  Dashboard,
  FileStat,
  Flow,
  FormatReport,
  HistoryStats,
  SearchResult,
  SessionDetail,
  SessionSummary,
  ToolCallRow,
  TranscriptPage,
} from '$shared/types';

export interface HistoryFilter {
  days?: number;
  project?: string;
}

function qs(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as [string, string | number | boolean | undefined][]) if (v !== undefined && v !== '' && v !== false) q.set(k, v === true ? '1' : String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const api = {
  dashboard: () => get<Dashboard>('/api/dashboard'),
  sessions: (offset: number, limit: number, q = '') =>
    get<{ total: number; items: SessionSummary[] }>(`/api/sessions?offset=${offset}&limit=${limit}&q=${enc(q)}`),
  session: (id: string) => get<SessionDetail>(`/api/session/${enc(id)}`),
  transcript: (id: string, agent: string | undefined, from: number) =>
    get<TranscriptPage>(`/api/transcript/${enc(id)}?from=${from}${agent ? `&agent=${enc(agent)}` : ''}`),
  raw: (id: string, agent: string | undefined, line: number) =>
    get<unknown>(`/api/raw/${enc(id)}?line=${line}${agent ? `&agent=${enc(agent)}` : ''}`),
  formats: () => get<FormatReport>('/api/formats'),
  flow: (id: string) => get<Flow>(`/api/flow/${enc(id)}`),
  stats: (f: HistoryFilter) => get<HistoryStats>(`/api/stats${qs({ ...f })}`),
  projects: () => get<string[]>('/api/projects'),
  tools: (p: HistoryFilter & { name?: string; q?: string; session?: string; file?: string; errors?: boolean; offset?: number; limit?: number }) =>
    get<{ total: number; rows: ToolCallRow[]; names: string[] }>(`/api/tools${qs(p)}`),
  files: (p: HistoryFilter & { q?: string }) => get<{ total: number; files: FileStat[] }>(`/api/files${qs(p)}`),
  search: (q: string) => get<SearchResult>(`/api/search${qs({ q })}`),
};
