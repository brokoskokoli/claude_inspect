import type { ActivityInfo, Entry, PendingTool, ToolUseEntry } from '../../shared/types.js';
import { toolSummary } from '../../shared/tools.js';
import { num, str } from '../formats/util.js';

export interface TranscriptAnalysis {
  model?: string;
  effort?: string;
  permissionMode?: string;
  gitBranch?: string;
  title?: string;
  lastPrompt?: string;
  costUSD?: number;
  lastActivityAt?: string;
  contextTokens?: number;
  outputTokens: number;
  toolCalls: number;
  pendingTools: PendingTool[];
  current: ActivityInfo | null;
  /** Letzte Antwort beendet (end_turn) und nichts offen. */
  finished: boolean;
  /** Mit Fehler abgebrochen (API-Fehler als letztes Ereignis). */
  errored: boolean;
}

const SIGNIFICANT = new Set(['user-text', 'assistant-text', 'thinking', 'tool-use', 'tool-result']);

function short(s: string, max = 140): string {
  const one = s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*|__|`|^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

export function analyze(entries: Entry[]): TranscriptAnalysis {
  const a: TranscriptAnalysis = { outputTokens: 0, toolCalls: 0, pendingTools: [], current: null, finished: false, errored: false };
  const open = new Map<string, ToolUseEntry>();
  const outputByMessage = new Map<string, number>();
  const titles: Record<string, string> = {};

  for (const e of entries) {
    if (e.timestamp && (!a.lastActivityAt || e.timestamp > a.lastActivityAt)) a.lastActivityAt = e.timestamp;
    switch (e.kind) {
      case 'tool-use':
        a.toolCalls++;
        open.set(e.toolUseId, e);
        break;
      case 'tool-result':
        open.delete(e.toolUseId);
        break;
      case 'user-text':
        if (e.permissionMode) a.permissionMode = e.permissionMode;
        if (!e.isMeta && e.text && !e.text.startsWith('<')) a.lastPrompt = e.text;
        break;
      case 'meta': {
        const d = e.data;
        if (e.metaType === 'permission-mode' && str(d.permissionMode)) a.permissionMode = str(d.permissionMode);
        if (e.metaType === 'custom-title' && str(d.customTitle)) titles.custom = str(d.customTitle)!;
        if (e.metaType === 'agent-name' && str(d.agentName)) titles.agent = str(d.agentName)!;
        if (e.metaType === 'ai-title' && str(d.aiTitle)) titles.ai = str(d.aiTitle)!;
        if (e.metaType === 'last-prompt' && str(d.lastPrompt)) a.lastPrompt = str(d.lastPrompt);
        if (e.metaType === 'cost-state' && num(d.totalCostUSD) !== undefined) a.costUSD = num(d.totalCostUSD);
        break;
      }
    }
    if ((e.kind === 'assistant-text' || e.kind === 'thinking' || e.kind === 'tool-use') && e.usage) {
      if (e.model && e.model !== '<synthetic>') a.model = e.model;
      if (e.effort) a.effort = e.effort;
      const u = e.usage;
      a.contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      if (e.messageId) outputByMessage.set(e.messageId, u.output_tokens ?? 0);
    }
  }
  for (const v of outputByMessage.values()) a.outputTokens += v;
  a.title = titles.custom ?? titles.agent ?? titles.ai;

  a.pendingTools = [...open.values()].map((t) => ({
    toolUseId: t.toolUseId,
    name: t.name,
    summary: toolSummary(t.name, t.input),
    since: t.timestamp,
  }));

  // Aktuelle Aktivität aus dem letzten bedeutsamen Eintrag
  let last: Entry | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === 'system' && e.subtype === 'api_error') {
      a.current = { kind: 'error', label: short(e.text ?? String((e.data.error as { message?: string })?.message ?? 'API-Fehler')), since: e.timestamp };
      a.errored = true;
      return a;
    }
    if (SIGNIFICANT.has(e.kind) && !e.isMeta) {
      last = e;
      break;
    }
  }
  const pending = a.pendingTools.at(-1);
  if (pending) {
    a.current = { kind: 'tool', label: pending.summary, toolName: pending.name, since: pending.since };
  } else if (last) {
    switch (last.kind) {
      case 'assistant-text':
        if (last.stopReason === 'end_turn' || last.stopReason === 'stop_sequence') {
          a.finished = true;
          a.current = { kind: 'idle', label: short(last.text), since: last.timestamp };
        } else {
          a.current = { kind: 'text', label: short(last.text), since: last.timestamp };
        }
        break;
      case 'thinking':
        a.current = { kind: 'thinking', label: short(last.text) || 'denkt nach', since: last.timestamp };
        break;
      case 'tool-result':
        a.current = { kind: 'waiting', label: 'Modell arbeitet (nach Tool-Ergebnis)', since: last.timestamp };
        break;
      case 'user-text':
        a.current = { kind: 'waiting', label: 'neue Eingabe: ' + short(last.text, 100), since: last.timestamp };
        break;
    }
  }
  return a;
}
