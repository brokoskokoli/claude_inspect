import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { addUsage, emptyTotals, estimateCost, mergeTotals, type TokenTotals } from '../../shared/pricing.js';
import { toolSummary } from '../../shared/tools.js';
import type { DayStat, Entry, FileStat, HistoryStats, ProjectStat, ToolCallRow, ToolStat, Usage } from '../../shared/types.js';
import { registry } from '../formats/index.js';
import type { DecodedEntry } from '../formats/transcript/common.js';
import type { TranscriptFile } from '../sources/projects.js';
import { subagentDir } from '../sources/subagents.js';
import { JsonlTail } from '../util/jsonl.js';

/**
 * Aggregiert die komplette History im Arbeitsspeicher: Tokens und Kosten je
 * Modell/Tag/Projekt, alle Tool-Aufrufe (für den Tool-Explorer), berührte
 * Dateien und Aktivitätszeiten. Nichts wird gespeichert – nach einem Neustart
 * wird neu gescannt (ca. 2–3 s für 600 MB), danach nur noch inkrementell.
 */

interface UsageRec {
  model: string;
  ts: number;
  usage: Usage;
}

interface FileAgg {
  path: string;
  size: number;
  sessionId: string;
  agentId?: string;
  project: string;
  tail: JsonlTail;
  /** letzte Usage je Message-Id (ein Request erscheint in mehreren Records) */
  usage: Map<string, UsageRec>;
  calls: ToolCallRow[];
  callIdx: Map<string, number>;
  prompts: number[];
  firstTs?: number;
  lastTs?: number;
}

const FILE_TOOLS: Record<string, 'reads' | 'edits' | 'writes'> = {
  Read: 'reads',
  Edit: 'edits',
  MultiEdit: 'edits',
  NotebookEdit: 'edits',
  Write: 'writes',
};

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function p95(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

export interface HistoryFilter {
  project?: string;
  /** nur die letzten N Tage */
  days?: number;
}

export interface ToolQuery extends HistoryFilter {
  name?: string;
  q?: string;
  sessionId?: string;
  errorsOnly?: boolean;
  file?: string;
  offset?: number;
  limit?: number;
}

export class HistoryIndex {
  private files = new Map<string, FileAgg>();
  ready = false;
  totalFiles = 0;

  /**
   * @param projectOf liefert den Projektnamen einer Session (aus der Zusammenfassung)
   * @param full      beim ersten Lauf auch alle Subagent-Verzeichnisse durchsuchen
   */
  async refresh(transcripts: TranscriptFile[], projectOf: (f: TranscriptFile) => Promise<string>, full: boolean): Promise<void> {
    const seen = new Set<string>();
    for (const f of transcripts) {
      const project = await projectOf(f);
      seen.add(f.path);
      await this.scan(f.path, f.size, f.sessionId, undefined, project);
      if (!full && Date.now() - f.mtime > 3600_000) {
        for (const p of this.files.keys()) if (p.startsWith(subagentDir(f.path))) seen.add(p);
        continue;
      }
      const dir = subagentDir(f.path);
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        /* keine Subagenten */
      }
      for (const n of names) {
        const m = /^agent-(.+)\.jsonl$/.exec(n);
        if (!m) continue;
        const path = join(dir, n);
        seen.add(path);
        try {
          await this.scan(path, (await stat(path)).size, f.sessionId, m[1], project);
        } catch {
          /* gelöscht */
        }
      }
    }
    // Von Claude Code aufgeräumte Dateien vergessen
    for (const p of [...this.files.keys()]) if (!seen.has(p)) this.files.delete(p);
    this.totalFiles = this.files.size;
    this.ready = true;
  }

  private async scan(path: string, size: number, sessionId: string, agentId: string | undefined, project: string): Promise<void> {
    let agg = this.files.get(path);
    if (agg && agg.size === size) return;
    if (!agg || size < agg.size) {
      agg = { path, size: 0, sessionId, agentId, project, tail: new JsonlTail(path), usage: new Map(), calls: [], callIdx: new Map(), prompts: [] };
      this.files.set(path, agg);
    }
    agg.size = size;
    agg.project = project;
    let lines;
    try {
      ({ lines } = await agg.tail.readNew());
    } catch {
      return;
    }
    for (const l of lines) {
      if (l.value === undefined) continue;
      const { out } = registry.decode<DecodedEntry[]>('transcript', l.value, path, l.line, { silent: true });
      for (const e of out) this.fold(agg, e as Entry);
    }
  }

  private fold(agg: FileAgg, e: Entry): void {
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (agg.firstTs === undefined || ts < agg.firstTs) agg.firstTs = ts;
      if (agg.lastTs === undefined || ts > agg.lastTs) agg.lastTs = ts;
    }
    switch (e.kind) {
      case 'tool-use': {
        if (agg.callIdx.has(e.toolUseId)) break; // doppelte Records (Resume/Fork)
        const file = typeof e.input.file_path === 'string' ? e.input.file_path : typeof e.input.notebook_path === 'string' ? e.input.notebook_path : undefined;
        agg.callIdx.set(e.toolUseId, agg.calls.length);
        agg.calls.push({
          sessionId: agg.sessionId,
          agentId: agg.agentId,
          project: agg.project,
          toolUseId: e.toolUseId,
          name: e.name,
          summary: toolSummary(e.name, e.input).slice(0, 200),
          ts: Number.isNaN(ts) ? 0 : ts,
          file,
        });
        break;
      }
      case 'tool-result': {
        const i = agg.callIdx.get(e.toolUseId);
        if (i === undefined) break;
        const c = agg.calls[i];
        if (!Number.isNaN(ts) && c.ts) c.durationMs = Math.max(0, ts - c.ts);
        c.isError = e.isError || undefined;
        c.denied = e.denied ? true : undefined;
        break;
      }
      case 'user-text':
        if (!agg.agentId && !e.isMeta && !e.isCompactSummary && e.text && !e.text.startsWith('<') && !Number.isNaN(ts)) agg.prompts.push(ts);
        break;
    }
    if ((e.kind === 'assistant-text' || e.kind === 'thinking' || e.kind === 'tool-use') && e.usage && e.messageId && e.model && e.model !== '<synthetic>') {
      agg.usage.set(e.messageId, { model: e.model, ts: Number.isNaN(ts) ? 0 : ts, usage: e.usage });
    }
  }

  // ---------------------------------------------------------------------------

  private selected(f: HistoryFilter): { aggs: FileAgg[]; since: number } {
    const since = f.days ? Date.now() - f.days * 86_400_000 : 0;
    const aggs = [...this.files.values()].filter((a) => (!f.project || a.project === f.project) && (a.lastTs ?? 0) >= since);
    return { aggs, since };
  }

  stats(filter: HistoryFilter = {}): HistoryStats {
    const { aggs, since } = this.selected(filter);
    const byModel = new Map<string, TokenTotals>();
    const days = new Map<string, DayStat & { sessionSet: Set<string> }>();
    const projects = new Map<string, ProjectStat & { sessionSet: Set<string> }>();
    const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const tools = new Map<string, { count: number; errors: number; denied: number; durations: number[] }>();
    const sessions = new Set<string>();
    const total = emptyTotals();
    let costUSD = 0;
    let prompts = 0;
    let toolCalls = 0;
    let from: number | undefined;
    let to: number | undefined;

    const day = (ts: number) => {
      const k = dayKey(ts);
      let d = days.get(k);
      if (!d) days.set(k, (d = { day: k, byModel: {}, prompts: 0, toolCalls: 0, sessions: 0, sessionSet: new Set() }));
      return d;
    };
    const proj = (a: FileAgg) => {
      let p = projects.get(a.project);
      if (!p) projects.set(a.project, (p = { project: a.project, sessions: 0, toolCalls: 0, outputTokens: 0, costUSD: 0, sessionSet: new Set() }));
      return p;
    };

    for (const a of aggs) {
      const p = proj(a);
      for (const u of a.usage.values()) {
        if (u.ts < since) continue;
        const one = emptyTotals();
        addUsage(one, u.usage);
        let m = byModel.get(u.model);
        if (!m) byModel.set(u.model, (m = emptyTotals()));
        mergeTotals(m, one);
        mergeTotals(total, one);
        const cost = estimateCost(u.model, one) ?? 0;
        costUSD += cost;
        p.outputTokens += one.output;
        p.costUSD += cost;
        if (u.ts) {
          const d = day(u.ts);
          const dm = (d.byModel[u.model] ??= { output: 0, costUSD: 0 });
          dm.output += one.output;
          dm.costUSD += cost;
          d.sessionSet.add(a.sessionId);
          const dt = new Date(u.ts);
          heat[(dt.getDay() + 6) % 7][dt.getHours()]++;
          from = from === undefined ? u.ts : Math.min(from, u.ts);
          to = to === undefined ? u.ts : Math.max(to, u.ts);
        }
        sessions.add(a.sessionId);
        p.sessionSet.add(a.sessionId);
        p.lastActivity = !p.lastActivity || u.ts > Date.parse(p.lastActivity) ? new Date(u.ts).toISOString() : p.lastActivity;
      }
      for (const t of a.prompts) {
        if (t < since) continue;
        prompts++;
        day(t).prompts++;
      }
      for (const c of a.calls) {
        if (c.ts < since) continue;
        toolCalls++;
        p.toolCalls++;
        if (c.ts) day(c.ts).toolCalls++;
        let t = tools.get(c.name);
        if (!t) tools.set(c.name, (t = { count: 0, errors: 0, denied: 0, durations: [] }));
        t.count++;
        if (c.isError) t.errors++;
        if (c.denied) t.denied++;
        if (c.durationMs !== undefined) t.durations.push(c.durationMs);
      }
    }

    return {
      ready: this.ready,
      scannedFiles: this.files.size,
      totalFiles: this.totalFiles,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      totals: { sessions: sessions.size, prompts, toolCalls, costUSD, tokens: total },
      byModel: [...byModel.entries()]
        .map(([model, tokens]) => ({ model, tokens, costUSD: estimateCost(model, tokens) }))
        .sort((a, b) => (b.costUSD ?? 0) - (a.costUSD ?? 0)),
      byDay: [...days.values()]
        .map(({ sessionSet, ...d }) => ({ ...d, sessions: sessionSet.size }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      byProject: [...projects.values()]
        .map(({ sessionSet, ...p }) => ({ ...p, sessions: sessionSet.size }))
        .filter((p) => p.sessions > 0 || p.toolCalls > 0)
        .sort((a, b) => b.costUSD - a.costUSD),
      tools: [...tools.entries()]
        .map(([name, t]): ToolStat => ({
          name,
          count: t.count,
          errors: t.errors,
          denied: t.denied,
          avgMs: t.durations.length ? t.durations.reduce((x, y) => x + y, 0) / t.durations.length : undefined,
          p95Ms: p95(t.durations),
        }))
        .sort((a, b) => b.count - a.count),
      heat,
    };
  }

  toolCalls(q: ToolQuery): { total: number; rows: ToolCallRow[]; names: string[] } {
    const { aggs, since } = this.selected(q);
    const needle = q.q?.toLowerCase();
    const names = new Set<string>();
    const rows: ToolCallRow[] = [];
    for (const a of aggs) {
      if (q.sessionId && a.sessionId !== q.sessionId) continue;
      for (const c of a.calls) {
        names.add(c.name);
        if (c.ts < since) continue;
        if (q.name && c.name !== q.name) continue;
        if (q.errorsOnly && !c.isError && !c.denied) continue;
        if (q.file && c.file !== q.file) continue;
        if (needle && !`${c.summary} ${c.file ?? ''}`.toLowerCase().includes(needle)) continue;
        rows.push(c);
      }
    }
    rows.sort((x, y) => y.ts - x.ts);
    const offset = q.offset ?? 0;
    return { total: rows.length, rows: rows.slice(offset, offset + (q.limit ?? 100)), names: [...names].sort() };
  }

  fileStats(filter: HistoryFilter & { q?: string; limit?: number }): { total: number; files: FileStat[] } {
    const { aggs, since } = this.selected(filter);
    const needle = filter.q?.toLowerCase();
    const m = new Map<string, FileStat & { sessionSet: Set<string> }>();
    for (const a of aggs) {
      for (const c of a.calls) {
        const kind = FILE_TOOLS[c.name];
        if (!kind || !c.file || c.ts < since) continue;
        if (needle && !c.file.toLowerCase().includes(needle)) continue;
        let f = m.get(c.file);
        if (!f) m.set(c.file, (f = { path: c.file, project: a.project, reads: 0, edits: 0, writes: 0, sessions: 0, lastTs: 0, sessionSet: new Set() }));
        f[kind]++;
        f.sessionSet.add(a.sessionId);
        f.lastTs = Math.max(f.lastTs, c.ts);
      }
    }
    const files = [...m.values()]
      .map(({ sessionSet, ...f }) => ({ ...f, sessions: sessionSet.size }))
      .sort((a, b) => b.edits + b.writes - (a.edits + a.writes) || b.lastTs - a.lastTs);
    return { total: files.length, files: files.slice(0, filter.limit ?? 300) };
  }

  projects(): string[] {
    return [...new Set([...this.files.values()].map((a) => a.project))].sort();
  }
}
