import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessInfo, SpawnConfidence, SpawnLink } from '../../shared/types.js';
import { isObj, obj, str } from '../formats/util.js';
import { JsonlTail, readHeadTail } from '../util/jsonl.js';
import type { TranscriptFile } from './projects.js';
import { subagentDir } from './subagents.js';

/**
 * Verknüpft Claude-Sitzungen, die ein Agent per Bash startet (`claude -p …`,
 * `claude --agent …`), mit dem aufrufenden Tool-Aufruf. Claude Code schreibt
 * diese Beziehung nirgends hin, darum werden Indizien kombiniert:
 *
 *   Prozessbaum      laufendes Kind → Shell → laufender Eltern-Prozess (exakt)
 *   Session-Id       `--session-id <uuid>` / `--resume <uuid>` im Befehl (exakt)
 *   Prompt           erster Prompt des Kindes steht im Befehl
 *   Zeit             Kind startet kurz nach dem Aufruf
 *   Agent            `--agent X` im Befehl = agent-setting des Kindes
 *   Verzeichnis      `cd <cwd des Kindes>` im Befehl oder gleiches cwd
 */

export interface SpawnCall {
  sessionId: string;
  agentId?: string;
  toolUseId: string;
  ts: number;
  command: string;
  normCommand: string;
  words: Set<string>;
  cwd?: string;
  agentFlag?: string;
  sessionFlags: string[];
}

export interface ChildInfo {
  sessionId: string;
  startTs?: number;
  entrypoint?: string;
  promptSource?: string;
  agentSetting?: string;
  cwd?: string;
  prompt?: string;
}

/** `claude` als eigenständiges Kommando (auch mit Pfad), nicht z. B. "claude-inspect" oder ".claude/". */
const CLAUDE_CMD = /(?:^|[\s;&|(`]|\$\()(?:[\w./~-]*\/)?claude(?=\s|$)/m;
/** Aufrufe, die keine Sitzung erzeugen. */
const NO_SESSION = /^\s*(?:which|type|command -v)\b|claude\s+(?:--version|-v|update|doctor|mcp|config|install)\b/;
const NOT_A_CALL_BEFORE = /(?:\bwhich|\btype|command\s+-v|\bpgrep(?:\s+-\w+)*|\bpkill(?:\s+-\w+)*|\bkillall|\bman)\s+["']?[\w./~-]*$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

export function normalize(s: string): string {
  return s
    .replace(/\\\n/g, ' ')
    .replace(/\\(["'$`\\])/g, '$1')
    .replace(/\\012|\\n/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function words(s: string): string[] {
  return normalize(s)
    .split(/[^\p{L}\p{N}_./-]+/u)
    .filter((w) => w.length >= 3);
}

/** Zerlegt einen Shell-Befehl in die einzelnen claude-Aufrufe (bei `a && claude …; claude …`). */
export function claudeInvocations(command: string): string[] {
  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < 20; i++) {
    const m = CLAUDE_CMD.exec(command.slice(pos));
    if (!m) break;
    const abs = pos + m.index;
    const start = abs + m[0].length;
    const next = CLAUDE_CMD.exec(command.slice(start));
    const end = next ? start + next.index : command.length;
    // `which claude`, `pgrep -f claude` … nennen claude nur als Argument
    const before = command.slice(Math.max(0, abs - 24), abs + m[0].indexOf('claude'));
    if (!NOT_A_CALL_BEFORE.test(before)) out.push(command.slice(abs, end));
    pos = end;
  }
  return out;
}

export function parseCall(raw: Record<string, unknown>, block: Record<string, unknown>, sessionId: string, agentId?: string): SpawnCall[] {
  const input = obj(block.input);
  const command = str(input?.command);
  const ts = Date.parse(str(raw.timestamp) ?? '');
  if (!command || Number.isNaN(ts) || !CLAUDE_CMD.test(command)) return [];
  const out: SpawnCall[] = [];
  for (const inv of claudeInvocations(command)) {
    if (NO_SESSION.test(inv)) continue;
    const agentFlag = /--agent[=\s]+["']?([\w.-]+)/.exec(inv)?.[1];
    const sessionFlags = [...inv.matchAll(new RegExp(`--(?:session-id|resume|fork-session)[=\\s]+["']?(${UUID.source})`, 'g'))].map((m) => m[1]);
    out.push({
      sessionId,
      agentId,
      toolUseId: str(block.id) ?? '',
      ts,
      command,
      normCommand: normalize(inv),
      words: new Set(words(inv)),
      cwd: /(?:^|[\s;&(])cd\s+["']?([^\s"';&]+)/.exec(command)?.[1] ?? str(raw.cwd),
      agentFlag,
      sessionFlags,
    });
  }
  return out;
}

/** Bewertet, wie gut ein claude-Aufruf zu einer Kind-Sitzung passt (höher = besser). */
export function scoreSpawn(child: ChildInfo, call: SpawnCall): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  let score = 0;
  if (call.sessionFlags.includes(child.sessionId)) return { score: 1000, evidence: ['Session-Id im Befehl'] };
  if (child.prompt) {
    const np = normalize(child.prompt);
    const prefix = np.slice(0, 160);
    if (prefix.length >= 20 && call.normCommand.includes(prefix)) {
      score += 60;
      evidence.push('Prompt');
    } else if (prefix.length > 0 && prefix.length < 20 && new RegExp(`(?:^|\\s)-p ${prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:\\s|$)`).test(call.normCommand)) {
      // kurze Prompts wie "/usage": nur als exaktes -p-Argument werten
      score += 40;
      evidence.push('Prompt');
    } else {
      const pw = words(child.prompt).slice(0, 80);
      if (pw.length >= 5) {
        const ratio = pw.filter((w) => call.words.has(w)).length / pw.length;
        if (ratio >= 0.5) {
          score += Math.round(ratio * 45);
          evidence.push(`Prompt ~${Math.round(ratio * 100)} %`);
        }
      }
    }
  }
  if (call.agentFlag || child.agentSetting) {
    if (call.agentFlag && call.agentFlag === child.agentSetting) {
      score += 15;
      evidence.push('Agent');
    } else {
      score -= 25;
    }
  }
  if (child.startTs !== undefined) {
    const dt = (child.startTs - call.ts) / 1000;
    if (dt >= -2 && dt <= 30) {
      score += 15;
      evidence.push('Zeit');
    } else if (dt > 30 && dt <= 180) {
      score += 5;
      evidence.push('Zeit (grob)');
    }
  }
  if (child.cwd && call.cwd && child.cwd.replace(/\/$/, '') === call.cwd.replace(/\/$/, '')) {
    score += 5;
    evidence.push('Verzeichnis');
  }
  return { score, evidence };
}

interface FileState {
  size: number;
  tail: JsonlTail;
  calls: SpawnCall[];
}

export class SpawnIndex {
  private files = new Map<string, FileState>();
  private children = new Map<string, { size: number; info: ChildInfo }>();
  private links = new Map<string, SpawnLink>();

  /** Neue Zeilen aller Transcripts nach claude-Aufrufen durchsuchen (inkrementell). */
  async refresh(transcripts: TranscriptFile[], processes: ProcessInfo[], full: boolean): Promise<void> {
    for (const f of transcripts) {
      await this.scanFile(f.path, f.size, f.sessionId);
      // Subagenten können ebenfalls claude-Aufrufe machen. Nach dem ersten
      // Durchlauf nur noch bei kürzlich aktiven Sessions nachsehen.
      if (!full && Date.now() - f.mtime > 3600_000) continue;
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
        try {
          await this.scanFile(path, (await stat(path)).size, f.sessionId, m[1]);
        } catch {
          /* gelöscht */
        }
      }
    }
    for (const f of transcripts) await this.readChild(f);
    this.link(processes);
  }

  private async scanFile(path: string, size: number, sessionId: string, agentId?: string): Promise<void> {
    let st = this.files.get(path);
    if (st && st.size === size) return;
    if (!st || size < st.size) {
      st = { size: 0, tail: new JsonlTail(path), calls: [] };
      this.files.set(path, st);
    }
    st.size = size;
    try {
      const { lines, reset } = await st.tail.readNew((t) => t.includes('"Bash"') && t.includes('claude'));
      if (reset) st.calls = [];
      for (const l of lines) {
        const raw = l.value;
        if (!isObj(raw) || raw.type !== 'assistant') continue;
        const content = obj(raw.message)?.content;
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (isObj(b) && b.type === 'tool_use' && b.name === 'Bash') st.calls.push(...parseCall(raw, b, sessionId, agentId));
        }
      }
    } catch {
      /* gelöscht */
    }
  }

  /** Kopf eines Transcripts: Einstiegspunkt, erster Prompt, Startzeit, Agent. */
  private async readChild(f: TranscriptFile): Promise<void> {
    const cached = this.children.get(f.sessionId);
    if (cached && cached.info.prompt !== undefined && cached.size <= f.size) return;
    const info: ChildInfo = { sessionId: f.sessionId };
    try {
      const { head } = await readHeadTail(f.path, 96 * 1024, 0);
      for (const raw of head) {
        if (!isObj(raw)) continue;
        if (raw.type === 'agent-setting') info.agentSetting ??= str(raw.agentSetting);
        const ts = Date.parse(str(raw.timestamp) ?? '');
        if (!Number.isNaN(ts) && (info.startTs === undefined || ts < info.startTs)) info.startTs = ts;
        if (raw.type === 'queue-operation' && raw.operation === 'enqueue' && info.prompt === undefined) info.prompt = str(raw.content);
        if (raw.type === 'user' && !raw.isMeta) {
          info.entrypoint ??= str(raw.entrypoint);
          info.promptSource ??= str(raw.promptSource);
          info.cwd ??= str(raw.cwd);
          const c = obj(raw.message)?.content;
          const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (isObj(b) && b.type === 'text' ? str(b.text) : '')).join('\n') : '';
          if (text && !text.startsWith('<') && (info.prompt === undefined || info.promptSource === 'sdk')) info.prompt = text;
          if (info.entrypoint) break;
        }
      }
    } catch {
      /* gelöscht */
    }
    this.children.set(f.sessionId, { size: f.size, info });
  }

  private link(processes: ProcessInfo[]): void {
    const allCalls = [...this.files.values()].flatMap((f) => f.calls);
    const byPid = new Map(processes.filter((p) => p.alive).map((p) => [p.pid, p]));
    const links = new Map<string, SpawnLink>();

    for (const { info: child } of this.children.values()) {
      // Nur Sitzungen, die nicht interaktiv gestartet wurden, kommen als Kind in Frage.
      const proc = processes.find((p) => p.alive && p.sessionId === child.sessionId);
      const parentProc = proc?.parentPid ? byPid.get(proc.parentPid) : undefined;
      const isSdk = child.promptSource === 'sdk' || child.entrypoint?.startsWith('sdk');
      if (!isSdk && !parentProc) continue;

      let candidates = allCalls.filter((c) => c.sessionId !== child.sessionId);
      if (parentProc) {
        const own = candidates.filter((c) => c.sessionId === parentProc.sessionId);
        if (own.length) candidates = own;
      } else if (child.startTs !== undefined) {
        // ohne Prozessbaum: nur Aufrufe, die zeitlich passen
        candidates = candidates.filter((c) => child.startTs! - c.ts >= -2000 && child.startTs! - c.ts <= 600_000);
      }

      let best: { call: SpawnCall; score: number; evidence: string[] } | undefined;
      for (const call of candidates) {
        const r = scoreSpawn(child, call);
        if (!best || r.score > best.score || (r.score === best.score && call.ts > best.call.ts)) best = { call, ...r };
      }

      if (parentProc) {
        // Die Eltern-Session steht fest; der Tool-Aufruf ist das beste Indiz innerhalb dieser Session.
        const call = best && best.call.sessionId === parentProc.sessionId && best.score > 0 ? best : undefined;
        links.set(child.sessionId, {
          childSessionId: child.sessionId,
          parentSessionId: parentProc.sessionId,
          parentAgentId: call?.call.agentId,
          toolUseId: call?.call.toolUseId,
          confidence: 'exakt',
          evidence: ['Prozessbaum', ...(call?.evidence ?? [])],
          score: 1000 + (call?.score ?? 0),
        });
        continue;
      }
      if (!best || best.score < 40) continue;
      const confidence: SpawnConfidence = best.score >= 1000 ? 'exakt' : best.score >= 70 ? 'sicher' : 'wahrscheinlich';
      links.set(child.sessionId, {
        childSessionId: child.sessionId,
        parentSessionId: best.call.sessionId,
        parentAgentId: best.call.agentId,
        toolUseId: best.call.toolUseId,
        confidence,
        evidence: best.evidence,
        score: best.score,
      });
    }
    this.links = links;
  }

  parentOf(sessionId: string): SpawnLink | undefined {
    return this.links.get(sessionId);
  }

  childrenOf(sessionId: string): SpawnLink[] {
    return [...this.links.values()].filter((l) => l.parentSessionId === sessionId);
  }

  childInfo(sessionId: string): ChildInfo | undefined {
    return this.children.get(sessionId)?.info;
  }
}
