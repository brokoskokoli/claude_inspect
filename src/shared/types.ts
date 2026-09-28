// Normiertes Domain-Model. Wird von Server und Frontend gemeinsam genutzt.
// Die Decoder in src/server/formats übersetzen die Rohformate von Claude Code in diese Typen.

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  [k: string]: unknown;
}

export type EntryKind =
  | 'user-text'
  | 'assistant-text'
  | 'thinking'
  | 'tool-use'
  | 'tool-result'
  | 'image'
  | 'system'
  | 'attachment'
  | 'meta'
  | 'unknown';

interface EntryBase {
  /** Laufende Nummer innerhalb des Transcripts (vom Store vergeben). */
  seq: number;
  /** Zeilennummer in der Quelldatei (0-basiert), für die Rohansicht. */
  line: number;
  kind: EntryKind;
  /** Id des Decoders, der den Record gelesen hat. */
  decoder: string;
  recordType: string;
  version?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  agentId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  /** Felder, die der Decoder nicht kennt – gehen nie verloren. */
  extra?: Record<string, unknown>;
}

export interface UserTextEntry extends EntryBase {
  kind: 'user-text';
  text: string;
  permissionMode?: string;
  promptSource?: string;
  origin?: unknown;
  isCompactSummary?: boolean;
}

interface AssistantFields {
  model?: string;
  messageId?: string;
  requestId?: string;
  usage?: Usage;
  stopReason?: string | null;
  effort?: string;
  attribution?: { skill?: string; agent?: string; mcpServer?: string; mcpTool?: string; plugin?: string };
  isApiError?: boolean;
}

export interface AssistantTextEntry extends EntryBase, AssistantFields {
  kind: 'assistant-text';
  text: string;
}

export interface ThinkingEntry extends EntryBase, AssistantFields {
  kind: 'thinking';
  text: string;
  redacted?: boolean;
}

export interface ToolUseEntry extends EntryBase, AssistantFields {
  kind: 'tool-use';
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

export type ResultPart =
  | { type: 'text'; text: string; truncated?: number }
  | { type: 'image'; mediaType?: string }
  | { type: 'tool_reference'; toolName: string }
  | { type: 'other'; value: unknown };

export interface ToolResultEntry extends EntryBase {
  kind: 'tool-result';
  toolUseId: string;
  parts: ResultPart[];
  isError: boolean;
  /** Strukturiertes Ergebnis (`toolUseResult`), gekürzt. */
  structured?: unknown;
  denied?: string;
}

export interface ImageEntry extends EntryBase {
  kind: 'image';
  mediaType?: string;
}

export interface SystemEntry extends EntryBase {
  kind: 'system';
  subtype: string;
  level?: string;
  text?: string;
  data: Record<string, unknown>;
}

export interface AttachmentEntry extends EntryBase {
  kind: 'attachment';
  attachmentType: string;
  data: Record<string, unknown>;
}

export interface MetaEntry extends EntryBase {
  kind: 'meta';
  metaType: string;
  data: Record<string, unknown>;
}

export interface UnknownEntry extends EntryBase {
  kind: 'unknown';
  raw: unknown;
}

export type Entry =
  | UserTextEntry
  | AssistantTextEntry
  | ThinkingEntry
  | ToolUseEntry
  | ToolResultEntry
  | ImageEntry
  | SystemEntry
  | AttachmentEntry
  | MetaEntry
  | UnknownEntry;

// ---------------------------------------------------------------------------
// Prozesse, Jobs, Sessions

export interface ProcessInfo {
  pid: number;
  alive: boolean;
  sessionId: string;
  cwd?: string;
  name?: string;
  nameSource?: string;
  kind?: string;
  entrypoint?: string;
  version?: string;
  status?: string;
  statusUpdatedAt?: number;
  startedAt?: number;
  updatedAt?: number;
  bridgeSessionId?: string | null;
  jobId?: string;
  parkedJobId?: string;
  peerFeatures?: string[];
  /** Agent-Definition, mit der der Prozess gestartet wurde (z. B. per SDK). */
  agent?: string;
  /** PID des Claude-Prozesses, der diesen Prozess (über eine Shell) gestartet hat. */
  parentPid?: number;
  file: string;
  decoder: string;
  extra?: Record<string, unknown>;
}

export interface FanItem {
  id: string;
  kind: string;
  label: string;
  startedAt?: number;
}

export interface JobTimelineItem {
  at: string;
  state?: string;
  detail?: string;
  text?: string;
}

export interface JobInfo {
  short: string;
  state?: string;
  detail?: string;
  tempo?: string;
  fan: FanItem[];
  tokens?: number;
  intent?: string;
  name?: string;
  sessionId?: string;
  resumeSessionId?: string;
  cwd?: string;
  cliVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  inFlight?: Record<string, unknown>;
  /** Session, aus der dieser Job per Resume/Fork gestartet wurde (daemon/roster.json). */
  launch?: { mode?: string; fromSessionId?: string; fork?: boolean; source?: string };
  /** Fork-Information aus state.json (neuere Versionen). */
  fork?: { parentSessionId?: string; sessionId?: string; boundaryAt?: string; sourceAlive?: boolean };
  timeline: JobTimelineItem[];
  decoder: string;
  extra?: Record<string, unknown>;
}

export interface SessionEnded {
  /**
   * exit = mit /exit verlassen, archived = auf einem anderen Gerät beendet/archiviert,
   * no-conversation = Prozess einer IDE/eines SDK ohne Transcript (z. B. Chat-Panel geschlossen)
   */
  reason: 'exit' | 'archived' | 'no-conversation';
  at?: string;
}

export interface ActivityInfo {
  kind: 'tool' | 'thinking' | 'text' | 'waiting' | 'idle' | 'error';
  label: string;
  toolName?: string;
  since?: string;
}

export interface PendingTool {
  toolUseId: string;
  name: string;
  summary: string;
  since?: string;
}

export interface SubagentInfo {
  agentId: string;
  agentType?: string;
  description?: string;
  spawnDepth?: number;
  toolUseId?: string;
  background?: boolean;
  /** agentId des aufrufenden Subagenten, oder undefined = Hauptagent. */
  parentAgentId?: string;
  status: 'running' | 'done' | 'stale' | 'error';
  lastActivityAt?: string;
  model?: string;
  current?: ActivityInfo | null;
  toolCalls?: number;
  outputTokens?: number;
  extra?: Record<string, unknown>;
}

export interface SessionLive {
  sessionId: string;
  title?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  gitBranch?: string;
  lastActivityAt?: string;
  contextTokens?: number;
  outputTokens: number;
  toolCalls: number;
  current: ActivityInfo | null;
  pendingTools: PendingTool[];
  subagents: SubagentInfo[];
  subagentTotal: number;
  costUSD?: number;
  lastPrompt?: string;
  /** Von dieser Session per `claude`-Aufruf gestartete Sitzungen. */
  spawned: SpawnedSession[];
  ended?: SessionEnded;
}

export interface DashboardProcess {
  process: ProcessInfo;
  job?: JobInfo;
  session?: SessionLive;
  /** Diese Session wurde per `claude …`-Aufruf von einer anderen Session gestartet. */
  spawnedBy?: SpawnParent;
  /**
   * Prozess läuft noch, die Session ist aber verlassen (z. B. /exit bei einer Hintergrund-Session,
   * die als Prozess weiterläuft). Gehört nicht zu den laufenden Agenten.
   */
  inactive?: SessionEnded;
}

// ---------------------------------------------------------------------------
// Per Bash gestartete Claude-Sitzungen ("claude -p …", "claude --agent …")

export type SpawnConfidence = 'exact' | 'high' | 'likely';

export interface SpawnLink {
  childSessionId: string;
  parentSessionId: string;
  /** Gesetzt, wenn ein Subagent der Eltern-Session den Aufruf gemacht hat. */
  parentAgentId?: string;
  toolUseId?: string;
  confidence: SpawnConfidence;
  /** Welche Signale die Zuordnung tragen, z. B. ["Prozessbaum", "Prompt"]. */
  evidence: string[];
  score: number;
}

export interface SpawnParent extends SpawnLink {
  parentTitle?: string;
}

export interface SpawnedSession extends SpawnLink {
  title?: string;
  agent?: string;
  model?: string;
  status: 'running' | 'idle' | 'done';
  lastActivityAt?: string;
  current?: ActivityInfo | null;
  pid?: number;
}

export interface SessionSummary {
  sessionId: string;
  projectDir: string;
  project: string;
  cwd?: string;
  size: number;
  mtime: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  title?: string;
  lastPrompt?: string;
  versions: string[];
  model?: string;
  gitBranch?: string;
  subagentCount: number;
  costUSD?: number;
  live?: boolean;
  /** Gesetzt, wenn diese Session von einer anderen per `claude`-Aufruf gestartet wurde. */
  spawnedBy?: string;
}

export interface Dashboard {
  generatedAt: number;
  claudeDir: string;
  processes: DashboardProcess[];
  orphanJobs: JobInfo[];
  recentSessions: SessionSummary[];
}

export interface SessionDetail {
  summary: SessionSummary;
  subagents: SubagentInfo[];
  spawned: SpawnedSession[];
  spawnedBy?: SpawnParent;
  tasks: TaskItem[];
  process?: ProcessInfo;
  job?: JobInfo;
}

export interface TranscriptPage {
  sessionId: string;
  agentId?: string;
  entries: Entry[];
  total: number;
  from: number;
}

export interface DriftItem {
  source: string;
  recordType: string;
  field: string;
  count: number;
  firstVersion?: string;
  lastVersion?: string;
}

export interface DecoderInfo {
  id: string;
  source: string;
  description: string;
  versions?: string;
  hits: number;
}

export interface FormatReport {
  decoders: DecoderInfo[];
  drift: DriftItem[];
}

export type StreamEvent =
  | { type: 'dashboard'; data: Dashboard }
  | { type: 'transcript'; data: { sessionId: string; agentId?: string; total: number } };

// ---------------------------------------------------------------------------
// Phase 3: Ablauf (Zeitleiste + Graph)

export interface FlowSpan {
  toolUseId: string;
  name: string;
  summary: string;
  start: number;
  /** Ende; fehlt bei noch laufenden Aufrufen. */
  end?: number;
  isError?: boolean;
}

export interface FlowLane {
  /** Eindeutig innerhalb des Ablaufs: "<sessionId>" oder "<sessionId>/<agentId>". */
  id: string;
  sessionId: string;
  agentId?: string;
  kind: 'main' | 'subagent' | 'spawn';
  label: string;
  sublabel?: string;
  parentId?: string;
  /** Tool-Aufruf im Eltern-Agenten, der diese Lane gestartet hat. */
  viaToolUseId?: string;
  confidence?: SpawnConfidence;
  depth: number;
  status: 'running' | 'idle' | 'done' | 'stale' | 'error';
  model?: string;
  start?: number;
  end?: number;
  spans: FlowSpan[];
  /** Zeitpunkte der Modell-Antworten (für die Aktivitätsdichte). */
  turns: number[];
  toolCalls: number;
  outputTokens: number;
}

export interface Flow {
  rootSessionId: string;
  lanes: FlowLane[];
  /** Fork/Resume-Beziehungen der Wurzel-Session (aus Jobs/Daemon). */
  origin?: { kind: 'fork' | 'resume'; sessionId: string; title?: string };
}

// ---------------------------------------------------------------------------
// Phase 4: History

export interface TaskItem {
  id: string;
  subject?: string;
  description?: string;
  status?: string;
  activeForm?: string;
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  extra?: Record<string, unknown>;
}

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  requests: number;
}

export interface ModelStat {
  model: string;
  tokens: TokenBreakdown;
  costUSD?: number;
}

export interface DayStat {
  day: string; // YYYY-MM-DD (lokal)
  byModel: Record<string, { output: number; costUSD: number }>;
  prompts: number;
  toolCalls: number;
  sessions: number;
}

export interface ProjectStat {
  project: string;
  sessions: number;
  toolCalls: number;
  outputTokens: number;
  costUSD: number;
  lastActivity?: string;
}

export interface ToolStat {
  name: string;
  count: number;
  errors: number;
  denied: number;
  avgMs?: number;
  p95Ms?: number;
}

export interface HistoryStats {
  ready: boolean;
  scannedFiles: number;
  totalFiles: number;
  from?: string;
  to?: string;
  totals: { sessions: number; prompts: number; toolCalls: number; costUSD: number; tokens: TokenBreakdown };
  byModel: ModelStat[];
  byDay: DayStat[];
  byProject: ProjectStat[];
  tools: ToolStat[];
  /** Aktivität [Wochentag 0=Mo][Stunde] = Anzahl Modell-Antworten. */
  heat: number[][];
}

export interface ToolCallRow {
  sessionId: string;
  agentId?: string;
  project: string;
  toolUseId: string;
  name: string;
  summary: string;
  ts: number;
  durationMs?: number;
  isError?: boolean;
  denied?: boolean;
  file?: string;
}

export interface FileStat {
  path: string;
  project: string;
  reads: number;
  edits: number;
  writes: number;
  sessions: number;
  lastTs: number;
}

export interface SearchHit {
  sessionId: string;
  agentId?: string;
  project: string;
  title?: string;
  line: number;
  kind: string;
  toolName?: string;
  toolUseId?: string;
  ts?: string;
  snippet: string;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  scannedFiles: number;
  totalFiles: number;
  truncated: boolean;
  ms: number;
}
