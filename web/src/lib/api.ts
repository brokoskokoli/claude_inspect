import type {
  CpuHistory,
  Dashboard,
  FileStat,
  Flow,
  FormatReport,
  HistoryStats,
  SearchResult,
  SessionCost,
  SessionDetail,
  SessionSummary,
  ToolCallRow,
  TranscriptPage,
} from '$shared/types';
import type { ReviewRequest, ReviewRun, ReviewState } from '$shared/review';

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

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? String(r.status));
  return data;
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
  flow: (id: string, agent?: string) => get<Flow>(`/api/flow/${enc(id)}${qs({ agent })}`),
  cpu: (id: string) => get<CpuHistory>(`/api/cpu/${enc(id)}`),
  cost: (id: string, agent?: string) => get<SessionCost>(`/api/cost/${enc(id)}${qs({ agent })}`),
  review: (id: string, agent?: string) => get<ReviewState>(`/api/review/${enc(id)}${qs({ agent })}`),
  reviewDigestUrl: (id: string, agent?: string, full?: boolean) => `/api/review/${enc(id)}/digest${qs({ agent, full })}`,
  startReview: (id: string, req: ReviewRequest) => post<ReviewRun>(`/api/review/${enc(id)}`, req),
  launch: (sessionId: string, kind: string) => post<{ command: string }>(`/api/launch/${enc(sessionId)}`, { kind }),
  cancelReview: (runId: string) => post<{ cancelled: boolean }>(`/api/review-cancel/${enc(runId)}`, {}),
  stats: (f: HistoryFilter) => get<HistoryStats>(`/api/stats${qs({ ...f })}`),
  projects: () => get<string[]>('/api/projects'),
  tools: (p: HistoryFilter & { name?: string; q?: string; session?: string; file?: string; errors?: boolean; offset?: number; limit?: number }) =>
    get<{ total: number; rows: ToolCallRow[]; names: string[] }>(`/api/tools${qs(p)}`),
  files: (p: HistoryFilter & { q?: string }) => get<{ total: number; files: FileStat[] }>(`/api/files${qs(p)}`),
  search: (q: string) => get<SearchResult>(`/api/search${qs({ q })}`),
};
