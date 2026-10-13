import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  CpuHistory,
  CpuSnapshot,
  Dashboard,
  DashboardProcess,
  Flow,
  FlowLane,
  JobInfo,
  ProcessInfo,
  SearchAgent,
  SearchResult,
  SessionCost,
  CostBucket,
  CostRow,
  SessionDetail,
  SessionLive,
  SessionSummary,
  SpawnParent,
  SpawnedSession,
  StreamEvent,
  SubagentInfo,
  TranscriptPage,
} from '../shared/types.js';
import { CLAUDE_DIR, DATA_DIR, relToClaude } from './config.js';
import type { ReviewRequest, ReviewState } from '../shared/review.js';
import { buildDigest } from './review/digest.js';
import { findClaude, Reviewer } from './review/runner.js';
import { CpuMonitor } from './cpu-monitor.js';
import { registry } from './formats/index.js';
import { HistoryIndex, type HistoryFilter, type ToolQuery } from './history/aggregator.js';
import { emptyTotals, estimateCost, mergeTotals } from '../shared/pricing.js';
import { search, type SearchFile } from './history/search.js';
import { analyze } from './model/analyze.js';
import { laneData } from './model/flow.js';
import { readPlan } from './sources/plan.js';
import { readTasks } from './sources/tasks.js';
import { readJobs } from './sources/jobs.js';
import { readProcesses } from './sources/processes.js';
import { ProjectIndex, type TranscriptFile } from './sources/projects.js';
import { SpawnIndex } from './sources/spawns.js';
import { agentCallIds, listSubagents, type SubagentFile } from './sources/subagents.js';
import { TranscriptStore, type Transcript } from './sources/transcripts.js';

/**
 * IDE-Erweiterungen und SDK-Hosts (VS Code, JetBrains ACP …) halten claude-Prozesse am Leben,
 * auch wenn das Chat-Panel längst zu ist. Ohne Transcript gab es darin nie ein Gespräch.
 * Terminal-Sessions (entrypoint "cli") bleiben außen vor: Dort sitzt jemand vor dem Prompt.
 */
const IDE_GRACE_MS = 2 * 60_000;
function idleIdeProcess(p: ProcessInfo): boolean {
  if (p.status === 'busy' || !p.entrypoint || p.entrypoint === 'cli' || p.kind === 'bg') return false;
  return Date.now() - (p.startedAt ?? 0) > IDE_GRACE_MS;
}

/** Subagenten, deren Datei so lange unverändert ist, gelten ohne Abschluss als "stale". */
const SUBAGENT_STALE_MS = 10 * 60_000;
/** Subagenten erscheinen auf dem Dashboard, wenn sie so kürzlich aktiv waren. */
const SUBAGENT_DASHBOARD_MS = 30 * 60_000;

/** Sparbetrieb ohne offenen Tab: Prozessliste alle 30 s, Komplettaktualisierung alle 2 min */
const IDLE_POLL_MS = 30_000;
const IDLE_REBUILD_MS = 120_000;

export class Inspector extends EventEmitter<{ event: [StreamEvent] }> {
  readonly index = new ProjectIndex();
  readonly store = new TranscriptStore();
  /** Verknüpfung per Bash gestarteter claude-Sitzungen mit ihrem Aufrufer. */
  readonly spawns = new SpawnIndex();
  private spawnsReady = false;
  /** Aggregierte History (Tokens, Kosten, Tool-Aufrufe, Dateien) – nur im Speicher. */
  readonly history = new HistoryIndex();
  private historyReady = false;
  private historyRefreshedAt = 0;
  /**
   * Offene, sichtbare Browser-Tabs (Live-Verbindungen). Ohne Zuschauer läuft nur ein
   * Sparbetrieb: Prozessliste alle 30 s (für die CPU-Messung), alles andere alle 2 min.
   */
  private viewers = 0;
  private builtAt = 0;
  private historyReadyResolve!: () => void;
  /** Erfüllt, sobald der erste History-Scan durch ist (API-Aufrufe warten darauf). */
  readonly historyLoaded = new Promise<void>((r) => (this.historyReadyResolve = r));
  private processes: ProcessInfo[] = [];
  private jobs: JobInfo[] = [];
  private dashboard?: Dashboard;
  private dashboardJson = '';
  private watcher?: FSWatcher;
  private dirty = { processes: true, jobs: true, index: false, dashboard: true };
  private timer?: NodeJS.Timeout;
  private poller?: NodeJS.Timeout;
  private building?: Promise<void>;
  /** CPU-Auslastung je Claude-Prozess samt Unterprozessen */
  private readonly cpu: CpuMonitor;
  /** "Analyze with Claude": startet auf Knopfdruck `claude -p` (abschaltbar mit --no-analyze) */
  readonly reviewer?: Reviewer;

  constructor(opts: { cpuLog?: boolean; analyze?: boolean } = {}) {
    super();
    if (opts.analyze !== false) this.reviewer = new Reviewer(join(DATA_DIR, 'reviews'), (data) => this.emit('event', { type: 'review', data } satisfies StreamEvent));
    this.cpu = new CpuMonitor({
      log: opts.cpuLog ?? false,
      roots: () => new Map(this.processes.filter((p) => p.alive && p.pid > 0).map((p) => [p.pid, p.sessionId])),
      onSample: (data) => this.emit('event', { type: 'cpu', data }),
    });
  }

  async start(): Promise<void> {
    await this.index.scan();
    await this.rebuild();
    // Erster Komplettscan nach claude-Aufrufen läuft im Hintergrund, damit der Start schnell bleibt.
    void this.spawns
      .refresh(this.index.list(), this.processes, true)
      .then(() => {
        this.spawnsReady = true;
        this.schedule(0);
        return this.history.refresh(this.index.list(), this.projectOf, true);
      })
      .then(() => {
        this.historyReady = true;
        this.historyReadyResolve();
      });
    try {
      // macOS/Windows: rekursives Watching nativ. Linux (Node ≥ 20): ebenfalls unterstützt.
      this.watcher = watch(CLAUDE_DIR, { recursive: true }, (_ev, filename) => {
        if (filename) this.onFsEvent(join(CLAUDE_DIR, filename.toString()));
      });
      this.watcher.on('error', () => undefined);
    } catch {
      /* Fallback: nur Polling */
    }
    // Polling als Netz: Prozess-Liveness (kein Datei-Event beim Absturz) und verpasste Events.
    this.startPoller();
    this.cpu.start();
  }

  stop(): void {
    this.cpu.stop();
    this.watcher?.close();
    clearInterval(this.poller);
    clearTimeout(this.timer);
  }

  private get active(): boolean {
    return this.viewers > 0;
  }

  private startPoller(): void {
    clearInterval(this.poller);
    this.poller = setInterval(() => void this.poll(), this.active ? 5000 : IDLE_POLL_MS);
    this.cpu.setIdle(!this.active);
  }

  /** Anzahl offener Live-Verbindungen (sichtbare Tabs); schaltet zwischen Live- und Sparbetrieb. */
  setViewers(n: number): void {
    const was = this.active;
    this.viewers = n;
    if (was === this.active) return;
    this.startPoller();
    if (this.active) {
      // Zuschauer zurück: sofort alles auf Stand bringen
      this.dirty.processes = this.dirty.jobs = this.dirty.dashboard = true;
      this.historyRefreshedAt = 0;
      void this.poll();
    }
  }

  private onFsEvent(abs: string): void {
    const rel = relToClaude(abs);
    if (rel.startsWith('sessions/')) this.dirty.processes = true;
    else if (rel.startsWith('jobs/') || rel.startsWith('daemon/')) this.dirty.jobs = true;
    else if (rel.startsWith('projects/')) {
      if (rel.endsWith('.jsonl')) {
        if (this.active) void this.onTranscriptChanged(abs);
        if (!rel.includes('/subagents/')) void this.index.touch(abs);
      }
      this.dirty.dashboard = true;
    } else return;
    // ohne Zuschauer nur vormerken; der nächste Sparlauf holt es nach
    if (this.active) this.schedule();
  }

  private async onTranscriptChanged(path: string): Promise<void> {
    const r = await this.store.refreshIfLoaded(path);
    if (r) this.emitTranscript(r.transcript);
  }

  private emitTranscript(t: Transcript): void {
    this.emit('event', { type: 'transcript', data: { sessionId: t.sessionId, agentId: t.agentId, total: t.entries.length } });
  }

  private async poll(): Promise<void> {
    if (!this.active) {
      // Sparbetrieb: Prozessliste aktuell halten (CPU-Messung braucht die Claude-Prozesse),
      // den Rest nur alle 2 Minuten
      if (Date.now() - this.builtAt < IDLE_REBUILD_MS) {
        if (!this.building) {
          this.processes = await readProcesses();
        }
        return;
      }
      this.dirty.processes = true;
      this.dirty.jobs = true;
      this.schedule(0);
      return;
    }
    for (const t of this.store.all()) {
      try {
        const st = await stat(t.path);
        if (st.size !== t.bytes) await this.onTranscriptChanged(t.path);
      } catch {
        /* gelöscht */
      }
    }
    this.dirty.processes = true;
    this.dirty.jobs = true;
    this.schedule(0);
  }

  private schedule(delay = 250): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.rebuild(), delay);
  }

  private async rebuild(): Promise<void> {
    if (this.building) {
      this.schedule();
      return;
    }
    this.building = (async () => {
      if (this.dirty.processes) {
        this.dirty.processes = false;
        this.processes = await readProcesses();
      }
      if (this.dirty.jobs) {
        this.dirty.jobs = false;
        this.jobs = await readJobs();
      }
      if (this.spawnsReady) await this.spawns.refresh(this.index.list(), this.processes, false);
      // Statistik muss nicht im Sekundentakt nachziehen; laufende Agenten schreiben ständig
      if (this.historyReady && (!this.active || Date.now() - this.historyRefreshedAt > 5000)) {
        this.historyRefreshedAt = Date.now();
        await this.history.refresh(this.index.list(), this.projectOf, false);
      }
      this.dirty.dashboard = false;
      this.builtAt = Date.now();
      const d = await this.buildDashboard();
      const { generatedAt: _g, ...cmp } = d;
      const json = JSON.stringify(cmp);
      this.dashboard = d;
      if (json !== this.dashboardJson) {
        this.dashboardJson = json;
        this.emit('event', { type: 'dashboard', data: d });
      }
    })().finally(() => (this.building = undefined));
    await this.building;
  }

  cpuSnapshot(): CpuSnapshot {
    return this.cpu.snapshot();
  }

  cpuHistory(sessionId: string): Promise<CpuHistory> {
    return this.cpu.history(sessionId);
  }

  get cpuLogDir(): string | undefined {
    return this.cpu.logging ? this.cpu.dir : undefined;
  }

  async getDashboard(): Promise<Dashboard> {
    // Abruf ohne Live-Verbindung (z. B. API) im Sparbetrieb: nicht älter als 5 s ausliefern
    if (!this.dashboard || (!this.active && Date.now() - this.builtAt > 5000)) {
      this.dirty.processes = this.dirty.jobs = true;
      await this.rebuild();
    }
    return this.dashboard!;
  }

  // -------------------------------------------------------------------------

  private jobFor(p: ProcessInfo): JobInfo | undefined {
    return this.jobs.find((j) => j.short === p.jobId) ?? this.jobs.find((j) => j.short === p.parkedJobId);
  }

  private async buildDashboard(): Promise<Dashboard> {
    const procs = [...this.processes].sort((a, b) => Number(b.alive) - Number(a.alive) || (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0));
    const processes: DashboardProcess[] = [];
    for (const p of procs) {
      const dp: DashboardProcess = { process: p, job: this.jobFor(p), spawnedBy: await this.spawnParent(p.sessionId) };
      if (p.alive) {
        try {
          dp.session = await this.sessionLive(p.sessionId, p);
          if (dp.session?.ended && p.status !== 'busy') dp.inactive = dp.session.ended;
        } catch {
          /* Transcript nicht lesbar */
        }
        if (!dp.session && !this.index.get(p.sessionId) && idleIdeProcess(p)) dp.inactive = { reason: 'no-conversation', at: p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined };
      }
      processes.push(dp);
    }

    const usedJobs = new Set(processes.flatMap((p) => [p.process.jobId, p.process.parkedJobId]).filter(Boolean));
    const orphanJobs = this.jobs.filter((j) => !usedJobs.has(j.short)).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

    const liveIds = new Set(processes.filter((p) => p.process.alive).map((p) => p.process.sessionId));
    const recentSessions: SessionSummary[] = [];
    for (const f of this.index.list().slice(0, 25)) {
      const s = await this.index.summary(f);
      recentSessions.push({ ...s, live: liveIds.has(s.sessionId), spawnedBy: this.spawns.parentOf(s.sessionId)?.parentSessionId });
    }
    return { generatedAt: Date.now(), claudeDir: CLAUDE_DIR, platform: process.platform, processes, orphanJobs, recentSessions, plan: await readPlan() };
  }

  private async sessionLive(sessionId: string, p: ProcessInfo): Promise<SessionLive | undefined> {
    const f = this.index.get(sessionId);
    if (!f) return undefined;
    const t = await this.store.get(f.path, sessionId);
    const a = analyze(t.entries);
    const busy = p.status !== 'idle';
    const subFiles = await listSubagents(f.path);
    const recent = subFiles.filter((s) => Date.now() - s.mtime < SUBAGENT_DASHBOARD_MS);
    const subagents = await this.resolveSubagents(f.path, recent, true);
    let current = a.current;
    if (!busy && current && current.kind !== 'error') current = { kind: 'idle', label: current.kind === 'idle' ? current.label : 'waiting for input', since: current.since };
    return {
      sessionId,
      title: a.title,
      model: a.model,
      effort: a.effort,
      permissionMode: a.permissionMode,
      gitBranch: (await this.index.summary(f)).gitBranch,
      lastActivityAt: a.lastActivityAt,
      contextTokens: a.contextTokens,
      outputTokens: a.outputTokens,
      toolCalls: a.toolCalls,
      current,
      pendingTools: busy ? a.pendingTools : [],
      subagents,
      subagentTotal: subFiles.length,
      costUSD: a.costUSD,
      lastPrompt: a.lastPrompt,
      spawned: await this.spawnedSessions(sessionId),
      ended: a.ended,
    };
  }

  private async spawnParent(sessionId: string): Promise<SpawnParent | undefined> {
    const link = this.spawns.parentOf(sessionId);
    if (!link) return undefined;
    const pf = this.index.get(link.parentSessionId);
    const proc = this.processes.find((p) => p.alive && p.sessionId === link.parentSessionId);
    return { ...link, parentTitle: proc?.name ?? (pf ? (await this.index.summary(pf)).title : undefined) };
  }

  /** Von einer Session per `claude`-Aufruf gestartete Sitzungen mit Status. */
  private async spawnedSessions(parentSessionId: string): Promise<SpawnedSession[]> {
    const out: SpawnedSession[] = [];
    for (const link of this.spawns.childrenOf(parentSessionId)) {
      const f = this.index.get(link.childSessionId);
      if (!f) continue;
      const proc = this.processes.find((p) => p.alive && p.sessionId === link.childSessionId);
      const child = this.spawns.childInfo(link.childSessionId);
      const s: SpawnedSession = {
        ...link,
        agent: proc?.agent ?? child?.agentSetting,
        pid: proc?.pid,
        status: proc ? (proc.status === 'idle' ? 'idle' : 'running') : 'done',
      };
      if (proc) {
        const a = analyze((await this.store.get(f.path, link.childSessionId)).entries);
        Object.assign(s, { title: a.title, model: a.model, lastActivityAt: a.lastActivityAt, current: a.current });
        if (a.finished && proc.status === 'idle') s.status = 'idle';
      } else {
        const sum = await this.index.summary(f);
        Object.assign(s, { title: sum.title, model: sum.model, lastActivityAt: sum.lastTimestamp });
      }
      // Ohne Titel (z. B. `claude -p "/usage"`): erste Zeile des Auftrags anzeigen
      s.title ??= child?.prompt?.split('\n', 1)[0].slice(0, 120);
      out.push(s);
    }
    return out.sort((a, b) => (a.lastActivityAt ?? '').localeCompare(b.lastActivityAt ?? ''));
  }

  /**
   * Baut SubagentInfo inkl. Eltern-Zuordnung. `load` = Transcripts laden, um
   * Status und aktuelle Aktivität zu bestimmen (für Dashboard und Detailansicht).
   */
  private async resolveSubagents(sessionPath: string, files: SubagentFile[], load: boolean): Promise<SubagentInfo[]> {
    const sessionId = basename(sessionPath, '.jsonl');
    const out: SubagentInfo[] = [];
    for (const sf of files) {
      const info: SubagentInfo = {
        agentId: sf.agentId,
        ...sf.meta,
        status: 'stale',
        lastActivityAt: new Date(sf.mtime).toISOString(),
      };
      if (load) {
        const t = await this.store.get(sf.path, sessionId, sf.agentId);
        const a = analyze(t.entries);
        const fresh = Date.now() - sf.mtime < SUBAGENT_STALE_MS;
        info.status = a.errored ? 'error' : a.finished ? 'done' : fresh ? 'running' : 'stale';
        info.model = a.model;
        info.current = info.status === 'running' ? a.current : null;
        info.toolCalls = a.toolCalls;
        info.outputTokens = a.outputTokens;
        info.lastActivityAt = a.lastActivityAt ?? info.lastActivityAt;
        if (!info.description) info.description = a.title;
      }
      out.push(info);
    }
    // Eltern: Tiefe 1 → Hauptagent. Tiefer: der Subagent, dessen Datei den Agent-Aufruf enthält.
    const all = files.length && out.some((s) => (s.spawnDepth ?? 1) > 1) ? await listSubagents(sessionPath) : [];
    for (const s of out) {
      if ((s.spawnDepth ?? 1) <= 1 || !s.toolUseId) continue;
      for (const cand of all) {
        if (cand.agentId === s.agentId) continue;
        if ((await agentCallIds(cand.path, cand.size)).has(s.toolUseId)) {
          s.parentAgentId = cand.agentId;
          break;
        }
      }
    }
    return out.sort((a, b) => (a.lastActivityAt ?? '').localeCompare(b.lastActivityAt ?? ''));
  }

  // -------------------------------------------------------------------------
  // API

  async sessions(offset: number, limit: number, q?: string): Promise<{ total: number; items: SessionSummary[] }> {
    let files = this.index.list();
    const liveIds = new Set(this.processes.filter((p) => p.alive).map((p) => p.sessionId));
    if (q) {
      const needle = q.toLowerCase();
      const matches: SessionSummary[] = [];
      for (const f of files) {
        const s = await this.index.summary(f);
        if ([s.project, s.title, s.lastPrompt, s.sessionId, s.cwd].some((x) => x?.toLowerCase().includes(needle))) matches.push(s);
      }
      return {
        total: matches.length,
        items: matches.slice(offset, offset + limit).map((s) => ({ ...s, live: liveIds.has(s.sessionId), spawnedBy: this.spawns.parentOf(s.sessionId)?.parentSessionId })),
      };
    }
    const total = files.length;
    files = files.slice(offset, offset + limit);
    const items = await Promise.all(
      files.map(async (f) => ({ ...(await this.index.summary(f)), live: liveIds.has(f.sessionId), spawnedBy: this.spawns.parentOf(f.sessionId)?.parentSessionId })),
    );
    return { total, items };
  }

  async sessionDetail(sessionId: string): Promise<SessionDetail | undefined> {
    const f = this.index.get(sessionId);
    if (!f) return undefined;
    const summary = await this.index.summary(f);
    const files = await listSubagents(f.path);
    // Status aller Subagenten braucht deren Inhalt; kleine Dateien, daher vertretbar.
    const subagents = await this.resolveSubagents(f.path, files, true);
    const process = this.processes.find((p) => p.sessionId === sessionId && p.alive) ?? this.processes.find((p) => p.sessionId === sessionId);
    const job = process ? this.jobFor(process) : this.jobs.find((j) => j.sessionId === sessionId || j.resumeSessionId === sessionId);
    return {
      summary: { ...summary, live: !!process?.alive },
      subagents,
      spawned: await this.spawnedSessions(sessionId),
      spawnedBy: await this.spawnParent(sessionId),
      tasks: await readTasks(sessionId),
      process,
      job,
    };
  }

  private async transcriptFor(sessionId: string, agentId?: string): Promise<Transcript | undefined> {
    const f = this.index.get(sessionId);
    if (!f) return undefined;
    if (!agentId) return this.store.get(f.path, sessionId);
    const sub = (await listSubagents(f.path)).find((s) => s.agentId === agentId);
    return sub ? this.store.get(sub.path, sessionId, agentId) : undefined;
  }

  async transcript(sessionId: string, agentId: string | undefined, from: number): Promise<TranscriptPage | undefined> {
    const t = await this.transcriptFor(sessionId, agentId);
    if (!t) return undefined;
    return { sessionId, agentId, entries: t.entries.slice(from), total: t.entries.length, from };
  }

  async rawLine(sessionId: string, agentId: string | undefined, line: number): Promise<string | undefined> {
    const t = await this.transcriptFor(sessionId, agentId);
    return t?.rawLine(line);
  }

  private projectOf = async (f: TranscriptFile): Promise<string> => (await this.index.summary(f)).project;

  async historyStats(filter: HistoryFilter) {
    await this.historyLoaded;
    return this.history.stats(filter);
  }

  async toolCalls(q: ToolQuery) {
    await this.historyLoaded;
    return this.history.toolCalls(q);
  }

  async fileStats(filter: HistoryFilter & { q?: string }) {
    await this.historyLoaded;
    return this.history.fileStats(filter);
  }

  async historyProjects() {
    await this.historyLoaded;
    return this.history.projects();
  }

  async search(q: string): Promise<SearchResult> {
    const files: SearchFile[] = [];
    const subMeta = new Map<string, { type?: string; description?: string; path: string }>();
    for (const f of this.index.list()) {
      const sum = await this.index.summary(f);
      files.push({ path: f.path, sessionId: f.sessionId, project: sum.project, title: sum.title });
      for (const sf of await listSubagents(f.path)) {
        files.push({ path: sf.path, sessionId: f.sessionId, agentId: sf.agentId, project: sum.project, title: sf.meta.description ?? sum.title });
        subMeta.set(`${f.sessionId}/${sf.agentId}`, { type: sf.meta.agentType, description: sf.meta.description, path: sf.path });
      }
    }
    const res = await search(q, files, new Set(this.index.list().map((f) => f.sessionId)));

    // Agenten der Treffer samt Vorfahren (Hauptagent, per claude -p aufrufender Agent) für die Baumansicht
    const agents: Record<string, SearchAgent> = {};
    const home = homedir();
    const tilde = (p: string) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p);
    const add = async (sessionId: string, agentId: string | undefined, depth = 0): Promise<string | undefined> => {
      const key = agentId ? `${sessionId}/${agentId}` : sessionId;
      if (agents[key]) return key;
      const f = this.index.get(sessionId);
      if (!f || depth > 8) return undefined;
      const sum = await this.index.summary(f);
      if (agentId) {
        const m = subMeta.get(key);
        agents[key] = {
          key,
          sessionId,
          agentId,
          kind: 'subagent',
          label: m?.type ?? 'subagent',
          sublabel: m?.description,
          project: sum.project,
          parentKey: await add(sessionId, undefined, depth + 1),
          file: tilde(m?.path ?? f.path),
        };
        return key;
      }
      const link = this.spawns.parentOf(sessionId);
      const proc = this.processes.find((p) => p.sessionId === sessionId);
      agents[key] = {
        key,
        sessionId,
        kind: link ? 'spawn' : 'main',
        label: proc?.name ?? sum.title ?? sessionId.slice(0, 8),
        sublabel: link ? (this.spawns.childInfo(sessionId)?.agentSetting ?? 'claude -p') : undefined,
        project: sum.project,
        file: tilde(f.path),
      };
      if (link) agents[key].parentKey = await add(link.parentSessionId, link.parentAgentId, depth + 1);
      return key;
    };
    for (const h of res.hits) if (h.kind !== 'history-prompt') await add(h.sessionId, h.agentId);
    return { ...res, agents };
  }

  /**
   * Ablauf einer Session für Zeitleiste und Graph: Hauptagent, Subagenten
   * (verschachtelt) und per claude-Aufruf gestartete Sitzungen (rekursiv).
   */
  async flow(rootSessionId: string, agentId?: string): Promise<Flow | undefined> {
    const flow = await this.fullFlow(rootSessionId);
    if (!flow || !agentId) return flow;
    // nur ein Subagent samt allem, was er selbst gestartet hat – wie eine eigene Session
    const rootId = `${rootSessionId}/${agentId}`;
    const root = flow.lanes.find((l) => l.id === rootId);
    if (!root) return undefined;
    const keep = new Set([rootId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const l of flow.lanes) if (l.parentId && keep.has(l.parentId) && !keep.has(l.id)) keep.add(l.id), (grew = true);
    }
    const lanes = flow.lanes
      .filter((l) => keep.has(l.id))
      .map((l) => (l.id === rootId ? { ...l, parentId: undefined, viaToolUseId: undefined, depth: 0 } : { ...l, depth: l.depth - root.depth }));
    return { rootSessionId, lanes };
  }

  private async fullFlow(rootSessionId: string): Promise<Flow | undefined> {
    const rootFile = this.index.get(rootSessionId);
    if (!rootFile) return undefined;
    const lanes: FlowLane[] = [];
    const visited = new Set<string>();

    const addSession = async (
      f: TranscriptFile,
      kind: FlowLane['kind'],
      depth: number,
      parent?: { id: string; via?: string; confidence?: FlowLane['confidence'] },
    ) => {
      if (visited.has(f.sessionId) || depth > 6) return;
      visited.add(f.sessionId);
      const t = await this.store.get(f.path, f.sessionId);
      const a = analyze(t.entries);
      const sum = await this.index.summary(f);
      const proc = this.processes.find((p) => p.alive && p.sessionId === f.sessionId);
      const mainId = f.sessionId;
      lanes.push({
        id: mainId,
        sessionId: f.sessionId,
        kind,
        label: proc?.name ?? sum.title ?? this.spawns.childInfo(f.sessionId)?.prompt?.split('\n', 1)[0].slice(0, 80) ?? f.sessionId.slice(0, 8),
        sublabel: kind === 'spawn' ? (this.spawns.childInfo(f.sessionId)?.agentSetting ?? 'claude') : sum.project,
        parentId: parent?.id,
        viaToolUseId: parent?.via,
        confidence: parent?.confidence,
        depth,
        status: proc ? (proc.status === 'idle' ? 'idle' : 'running') : a.errored ? 'error' : 'done',
        ...laneData(t.entries),
      });

      const subFiles = await listSubagents(f.path);
      const subs = await this.resolveSubagents(f.path, subFiles, true);
      const subIds = new Set(subs.map((x) => x.agentId));
      const depthOf = (x: (typeof subs)[number]) => (x.spawnDepth ?? 1);
      for (const sub of [...subs].sort((x, y) => depthOf(x) - depthOf(y))) {
        const sf = subFiles.find((x) => x.agentId === sub.agentId)!;
        const st = await this.store.get(sf.path, f.sessionId, sub.agentId);
        lanes.push({
          id: `${f.sessionId}/${sub.agentId}`,
          sessionId: f.sessionId,
          agentId: sub.agentId,
          kind: 'subagent',
          label: sub.agentType ?? 'agent',
          sublabel: sub.description,
          parentId: sub.parentAgentId && subIds.has(sub.parentAgentId) ? `${f.sessionId}/${sub.parentAgentId}` : mainId,
          viaToolUseId: sub.toolUseId,
          depth: depth + depthOf(sub),
          status: sub.status,
          ...laneData(st.entries),
        });
      }
      for (const link of this.spawns.childrenOf(f.sessionId)) {
        const cf = this.index.get(link.childSessionId);
        if (!cf) continue;
        const parentId = link.parentAgentId && subIds.has(link.parentAgentId) ? `${f.sessionId}/${link.parentAgentId}` : mainId;
        const parentDepth = lanes.find((l) => l.id === parentId)?.depth ?? depth;
        await addSession(cf, 'spawn', parentDepth + 1, { id: parentId, via: link.toolUseId, confidence: link.confidence });
      }
    };

    await addSession(rootFile, 'main', 0);

    let origin: Flow['origin'];
    const job = this.jobs.find((j) => j.sessionId === rootSessionId || j.resumeSessionId === rootSessionId);
    const from = job?.fork?.parentSessionId ?? job?.launch?.fromSessionId;
    if (from && from !== rootSessionId) {
      const of = this.index.get(from);
      origin = { kind: job?.fork || job?.launch?.fork ? 'fork' : 'resume', sessionId: from, title: of ? (await this.index.summary(of)).title : undefined };
    }
    return { rootSessionId, lanes, origin };
  }

  /**
   * Geschätzte Kosten einer Session samt aller Subagenten und per `claude` gestarteten
   * Sitzungen (rekursiv, gleicher Baum wie Zeitleiste und Graph).
   */
  async sessionCost(rootSessionId: string, agentId?: string): Promise<SessionCost | undefined> {
    const flow = await this.flow(rootSessionId, agentId);
    if (!flow) return undefined;
    // nur die Dateien dieses Baums einlesen, statt auf den ersten vollständigen History-Scan zu warten
    for (const sid of new Set(flow.lanes.map((l) => l.sessionId))) {
      const f = this.index.get(sid);
      if (f) await this.history.ensureSession(f, await this.projectOf(f));
    }
    const seen = new Set<string>();
    const total = emptyTotals();
    const byModel = new Map<string, ReturnType<typeof emptyTotals>>();
    const unpriced = new Set<string>();
    let costUSD = 0;
    const points: { ts: number; cost: number; output: number; model: string; lane: FlowLane }[] = [];
    const rows: CostRow[] = flow.lanes.map((lane) => {
      const usage = this.history.usageOf(lane.sessionId, lane.agentId, seen, (model, ts, one) => {
        if (ts) points.push({ ts, cost: estimateCost(model, one) ?? 0, output: one.output, model, lane });
      });
      const tokens = emptyTotals();
      let cost = 0;
      const models = [...usage.entries()].map(([model, t]) => {
        mergeTotals(tokens, t);
        let m = byModel.get(model);
        if (!m) byModel.set(model, (m = emptyTotals()));
        mergeTotals(m, t);
        const c = estimateCost(model, t);
        if (c === undefined) unpriced.add(model);
        else cost += c;
        return { model, tokens: t, costUSD: c };
      });
      mergeTotals(total, tokens);
      costUSD += cost;
      return {
        id: lane.id,
        sessionId: lane.sessionId,
        agentId: lane.agentId,
        kind: lane.kind,
        label: lane.label,
        sublabel: lane.sublabel,
        parentId: lane.parentId,
        depth: lane.depth,
        status: lane.status,
        byModel: models.sort((a, b) => (b.costUSD ?? 0) - (a.costUSD ?? 0)),
        tokens,
        costUSD: cost,
      };
    });
    const rootFile = this.index.get(rootSessionId);
    return {
      rootSessionId,
      agentId,
      rows,
      total,
      costUSD,
      byModel: [...byModel.entries()]
        .map(([model, tokens]) => ({ model, tokens, costUSD: estimateCost(model, tokens) }))
        .sort((a, b) => (b.costUSD ?? 0) - (a.costUSD ?? 0)),
      unpricedModels: [...unpriced],
      // von Claude Code gemeldete Kosten gibt es nur für die ganze Session
      reportedCostUSD: rootFile && !agentId ? (await this.index.summary(rootFile)).costUSD : undefined,
      timeline: costTimeline(points),
    };
  }

  formats() {
    return registry.report();
  }

  /** Kompakter Bericht über die Session samt Subagenten und gestarteten Sitzungen (Grundlage der Analyse). */
  async reviewDigest(sessionId: string, agentId?: string, full = false) {
    const [flow, cost] = [await this.flow(sessionId, agentId), await this.sessionCost(sessionId, agentId)];
    const f = this.index.get(sessionId);
    if (!flow || !f) return undefined;
    const sum = await this.index.summary(f);
    const root = flow.lanes[0];
    const costOf = new Map(cost?.rows.map((r) => [r.id, r.costUSD]));
    const lanes = [];
    for (const lane of flow.lanes) {
      const t = await this.transcriptFor(lane.sessionId, lane.agentId);
      if (t) lanes.push({ lane, entries: t.entries, costUSD: costOf.get(lane.id) ?? 0 });
    }
    const title = agentId ? `subagent ${root?.label ?? agentId}${root?.sublabel ? ` – ${root.sublabel}` : ''} (in session "${sum.title ?? sessionId}")` : sum.title;
    return buildDigest({ title, project: sum.project, cwd: sum.cwd, gitBranch: sum.gitBranch, costUSD: cost?.costUSD ?? 0, lanes }, { full });
  }

  async reviewState(sessionId: string, agentId?: string): Promise<ReviewState | undefined> {
    if (!this.index.get(sessionId)) return undefined;
    if (!this.reviewer) return { available: false, disabled: true, runs: [] };
    const claudePath = await findClaude();
    return {
      available: !!claudePath,
      claudePath,
      disabled: false,
      digest: (await this.reviewDigest(sessionId, agentId))?.stats,
      fullDigest: (await this.reviewDigest(sessionId, agentId, true))?.stats,
      runs: await this.reviewer.list(sessionId, agentId),
    };
  }

  async startReview(sessionId: string, req: ReviewRequest) {
    if (!this.reviewer) throw new Error('Analysis is turned off (--no-analyze).');
    const agentId = typeof req.agentId === 'string' && /^[\w-]+$/.test(req.agentId) ? req.agentId : undefined;
    // Für ein Skript braucht Claude die vollständigen Befehle und Dateiinhalte
    const digest = await this.reviewDigest(sessionId, agentId, req.aspects?.includes('script'));
    if (!digest) throw new Error('unknown session');
    return this.reviewer.start(sessionId, digest, { ...req, agentId });
  }
}

const MIN = 60_000;
const BUCKET_SIZES = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MIN);

/** Verteilt die Modellantworten auf höchstens ~120 gleich lange Zeitabschnitte. */
function costTimeline(points: { ts: number; cost: number; output: number; model: string; lane: FlowLane }[]): SessionCost['timeline'] {
  if (!points.length) return { bucketMs: MIN, buckets: [] };
  let first = Infinity;
  let last = -Infinity;
  for (const p of points) {
    first = Math.min(first, p.ts);
    last = Math.max(last, p.ts);
  }
  const span = last - first;
  const bucketMs = BUCKET_SIZES.find((b) => span / b <= 120) ?? Math.ceil(span / 120 / (1440 * MIN)) * 1440 * MIN;
  // an der lokalen Uhr ausrichten (volle Minuten/Stunden/Tage)
  const offset = new Date(first).getTimezoneOffset() * MIN;
  const start = Math.floor((first - offset) / bucketMs) * bucketMs + offset;
  const n = Math.floor((last - start) / bucketMs) + 1;
  const buckets: (CostBucket & { lanes: Map<string, { label: string; sublabel?: string; costUSD: number }> })[] = Array.from({ length: n }, (_, i) => ({
    start: start + i * bucketMs,
    costUSD: 0,
    outputTokens: 0,
    requests: 0,
    byKind: {},
    byModel: {},
    top: [],
    lanes: new Map(),
  }));
  for (const p of points) {
    const b = buckets[Math.floor((p.ts - start) / bucketMs)];
    b.costUSD += p.cost;
    b.outputTokens += p.output;
    b.requests++;
    b.byKind[p.lane.kind] = (b.byKind[p.lane.kind] ?? 0) + p.cost;
    b.byModel[p.model] = (b.byModel[p.model] ?? 0) + p.cost;
    let l = b.lanes.get(p.lane.id);
    if (!l) b.lanes.set(p.lane.id, (l = { label: p.lane.label, sublabel: p.lane.sublabel, costUSD: 0 }));
    l.costUSD += p.cost;
  }
  return {
    bucketMs,
    buckets: buckets.map(({ lanes, ...b }) => ({
      ...b,
      top: [...lanes.entries()]
        .map(([id, l]) => ({ id, ...l }))
        .sort((x, y) => y.costUSD - x.costUSD)
        .slice(0, 3),
    })),
  };
}
