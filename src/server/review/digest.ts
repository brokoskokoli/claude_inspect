import { homedir } from 'node:os';
import { addUsage, emptyTotals, estimateCost } from '../../shared/pricing.js';
import type { DigestStats } from '../../shared/review.js';
import type { Entry, FlowLane, ToolResultEntry, ToolUseEntry } from '../../shared/types.js';

/**
 * Kompakter Bericht über eine Session samt Subagenten und gestarteten claude-Sitzungen,
 * als Grundlage für die Analyse durch Claude. Enthält Anfragen, Antworten (gekürzt), jeden
 * Tool-Aufruf mit Ergebnis-Status, Kosten und automatische Befunde. Geheimnisse werden maskiert.
 */

export interface DigestLane {
  lane: FlowLane;
  entries: Entry[];
  costUSD: number;
}

export interface DigestInput {
  title?: string;
  project: string;
  cwd?: string;
  gitBranch?: string;
  costUSD: number;
  lanes: DigestLane[];
}

/** ~70k Tokens – genug für lange Sessions, ohne das Limit unnötig zu belasten */
const MAX_CHARS = 240_000;

const LEVELS = [
  { prompt: 4000, text: 1200, err: 600, ok: 160, cmd: 400, body: 0 },
  { prompt: 2000, text: 500, err: 300, ok: 0, cmd: 240, body: 0 },
  { prompt: 1000, text: 200, err: 160, ok: 0, cmd: 160, body: 0 },
];
/** Für "Shell script": vollständige Befehle und Dateiinhalte (Write/Edit) */
const FULL_LEVELS = [
  { prompt: 4000, text: 800, err: 400, ok: 160, cmd: 6000, body: 8000 },
  { prompt: 2000, text: 400, err: 300, ok: 0, cmd: 3000, body: 3000 },
  { prompt: 1000, text: 200, err: 160, ok: 0, cmd: 1200, body: 1200 },
];
const FULL_MAX_CHARS = 400_000;
type Level = (typeof LEVELS)[number];

// --- Geheimnisse ---------------------------------------------------------------

const SECRET_PATTERNS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED:private-key]'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '[REDACTED:anthropic-key]'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED:api-key]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED:github-token]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED:github-token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED:slack-token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED:google-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED:jwt]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}=*/g, (_m, kind) => `${kind} [REDACTED:credential]`],
  [/(:\/\/[^\s:/@]+:)[^\s@/]{3,}@/g, (_m, pre) => `${pre}[REDACTED:password]@`],
  [
    /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth)["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
    (_m, pre) => `${pre}[REDACTED:secret]`,
  ],
];

export function redact(s: string, count: { n: number }): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) {
    out = out.replace(re, (...args: string[]) => {
      count.n++;
      return typeof rep === 'string' ? rep : rep(...args);
    });
  }
  return out;
}

// --- Hilfen ------------------------------------------------------------------

const home = homedir();
const tildify = (p: string) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p);

function oneLine(s: string, max: number): string {
  const t = s.replace(/\r/g, '').replace(/\n+/g, ' ⏎ ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + ` …[+${t.length - max}]` : t;
}

function block(s: string, max: number): string {
  const t = s.replace(/\r/g, '').trim();
  return t.length > max ? t.slice(0, max) + `\n…[${t.length - max} more characters]` : t;
}

const time = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour12: false }) : '--:--:--');
const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const kTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
function dur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h${Math.round((ms % 3600_000) / 60_000)}m`;
  return `${Math.floor(ms / 86_400_000)}d${Math.round((ms % 86_400_000) / 3600_000)}h`;
}

function resultText(r: ToolResultEntry): string {
  return r.parts.map((p) => (p.type === 'text' ? p.text : p.type === 'image' ? '[image]' : '')).join('\n');
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');

function toolDetail(e: ToolUseEntry, lv: Level): string {
  const i = e.input ?? {};
  switch (e.name) {
    case 'Bash':
      // für das Skript mehrzeilig lassen (Heredocs, Skripte)
      if (lv.body) return `${i.run_in_background ? '(background) ' : ''}\n\`\`\`sh\n${block(s(i.command), lv.cmd)}\n\`\`\``;
      return `${oneLine(s(i.command), lv.cmd)}${i.run_in_background ? ' (background)' : ''}`;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const p = tildify(s(i.file_path) || s(i.notebook_path));
      if (e.name === 'Write') return `${p} (${s(i.content).split('\n').length} lines)${lv.body ? `\n<<<CONTENT\n${block(s(i.content), lv.body)}\nCONTENT` : ''}`;
      if (e.name === 'Edit')
        return `${p} (−${s(i.old_string).split('\n').length}/+${s(i.new_string).split('\n').length} lines${i.replace_all ? ', all occurrences' : ''})${
          lv.body ? `\n<<<OLD\n${block(s(i.old_string), lv.body / 2)}\nOLD\n<<<NEW\n${block(s(i.new_string), lv.body / 2)}\nNEW` : ''
        }`;
      if (e.name === 'Read' && (i.offset || i.limit)) return `${p} (from ${i.offset ?? 0}, ${i.limit ?? 'all'} lines)`;
      return p;
    }
    case 'Grep':
    case 'Glob':
      return `${oneLine(s(i.pattern), 160)}${i.path ? ` in ${tildify(s(i.path))}` : ''}`;
    case 'Agent':
    case 'Task':
      return `${s(i.subagent_type) || 'agent'}: ${oneLine(s(i.description), 120)} – prompt: ${oneLine(s(i.prompt), lv.cmd)}`;
    case 'WebFetch':
      return `${s(i.url)}${i.prompt ? ` – ${oneLine(s(i.prompt), 120)}` : ''}`;
    case 'WebSearch':
      return oneLine(s(i.query), 200);
  }
  return oneLine(JSON.stringify(i), lv.cmd);
}

// --- Automatische Befunde ------------------------------------------------------

const SENSITIVE_PATH = /(^|[/\\\s"'])(\.env(\.[\w-]+)?|id_rsa|id_ed25519|id_ecdsa|[\w-]+\.pem|[\w-]+\.key|\.netrc|\.npmrc|\.pypirc|credentials(\.json)?|\.aws[/\\]|\.ssh[/\\]|\.kube[/\\]config|\.docker[/\\]config\.json|secrets?\.(json|ya?ml|env))(\b|$)/i;
// Aufrufe an localhost zählen nicht als Netzwerkverkehr nach außen
const NETWORK = /\b(scp|rsync|sftp|ssh|ncat|telnet|ftp)\b|https?:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\])|\b(curl|wget)\b(?![^\n|;&]*\b(localhost|127\.0\.0\.1)\b)/;
const UPLOAD = /\bcurl\b(?![^\n|;&]*\b(localhost|127\.0\.0\.1)\b)[^|]*(\s-d\b|--data|\s-F\b|--form|\s-T\b|--upload-file|-X\s*(POST|PUT|PATCH))|\bscp\b|\brsync\b.*:|\bgit\s+push\b/;
const RISKY: [RegExp, string][] = [
  [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/, 'rm -rf'],
  [/\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease)/, 'force push'],
  [/\bgit\s+reset\s+--hard/, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'git clean -f'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'discard all changes'],
  [/--no-verify\b/, '--no-verify'],
  [/\bsudo\b/, 'sudo'],
  [/\bchmod\s+(-R\s+)?777\b/, 'chmod 777'],
  [/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'pipe download to shell'],
  [/\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*;?\s*$)/i, 'destructive SQL'],
  [/--dangerously|bypassPermissions/, 'permission bypass'],
];

class Findings {
  toolCalls = 0;
  errors = 0;
  denied = 0;
  failing = new Map<string, number>();
  reads = new Map<string, number>();
  sensitive = new Map<string, number>();
  network: string[] = [];
  uploads: string[] = [];
  risky = new Map<string, string[]>();
  webFetches = 0;
  maxContext = 0;
  cacheRead = 0;
  inputAll = 0;
  compactions = 0;

  tool(lane: string, e: ToolUseEntry, r: ToolResultEntry | undefined, count: { n: number }) {
    this.toolCalls++;
    const i = e.input ?? {};
    const cmd = e.name === 'Bash' ? s(i.command) : '';
    const path = s(i.file_path) || s(i.notebook_path) || s(i.path);
    if (r?.isError) {
      this.errors++;
      const key = `${lane}: ${e.name} ${oneLine(redact(cmd || path || JSON.stringify(i), count), 140)}`;
      this.failing.set(key, (this.failing.get(key) ?? 0) + 1);
    }
    if (r?.denied) this.denied++;
    if (e.name === 'Read' && path) this.reads.set(`${lane}: ${tildify(path)}`, (this.reads.get(`${lane}: ${tildify(path)}`) ?? 0) + 1);
    for (const c of [path, cmd]) {
      const m = c && SENSITIVE_PATH.exec(c);
      if (m) {
        const k = `${e.name} ${oneLine(tildify(c), 140)}`;
        this.sensitive.set(redact(k, count), (this.sensitive.get(k) ?? 0) + 1);
        break;
      }
    }
    if (e.name === 'WebFetch' || e.name === 'WebSearch') this.webFetches++;
    if (cmd) {
      const short = oneLine(redact(cmd, count), 160);
      if (UPLOAD.test(cmd)) this.uploads.push(`${time(e.timestamp)} ${lane}: ${short}`);
      else if (NETWORK.test(cmd)) this.network.push(`${time(e.timestamp)} ${lane}: ${short}`);
      for (const [re, label] of RISKY) {
        if (re.test(cmd)) {
          const l = this.risky.get(label) ?? [];
          l.push(`${time(e.timestamp)} ${lane}: ${short}`);
          this.risky.set(label, l);
        }
      }
    }
  }

  render(redactions: number): string {
    const out: string[] = [];
    const top = <T>(m: Map<string, T>, n: number, f: (k: string, v: T) => string) => [...m.entries()].slice(0, n).map(([k, v]) => f(k, v));
    out.push(`- Tool calls: ${this.toolCalls}, failed: ${this.errors}, permission denied: ${this.denied}`);
    const repeatedFails = new Map([...this.failing].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]));
    if (repeatedFails.size) out.push('- Same call failed repeatedly:', ...top(repeatedFails, 8, (k, n) => `  - ${n}× ${k}`));
    const repeatedReads = new Map([...this.reads].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]));
    if (repeatedReads.size) out.push('- Same file read 3+ times:', ...top(repeatedReads, 8, (k, n) => `  - ${n}× ${k}`));
    if (this.inputAll) out.push(`- Prompt cache: ${Math.round((this.cacheRead / this.inputAll) * 100)}% of input tokens read from cache; largest context ${kTok(this.maxContext)} tokens; context compactions: ${this.compactions}`);
    if (this.sensitive.size) out.push('- Access to possibly sensitive files:', ...top(this.sensitive, 10, (k, n) => `  - ${n > 1 ? `${n}× ` : ''}${k}`));
    if (redactions) out.push(`- ${redactions} secret-looking values were found in the session and replaced with [REDACTED:…] in this digest`);
    if (this.uploads.length) out.push('- Commands that send data out (upload/POST/push/copy to remote):', ...this.uploads.slice(0, 10).map((l) => `  - ${l}`));
    if (this.network.length) out.push(`- Other network commands: ${this.network.length}`, ...this.network.slice(0, 6).map((l) => `  - ${l}`));
    if (this.webFetches) out.push(`- WebFetch/WebSearch calls: ${this.webFetches}`);
    for (const [label, list] of this.risky) out.push(`- Risky pattern "${label}": ${list.length}×`, ...list.slice(0, 5).map((l) => `  - ${l}`));
    return out.join('\n');
  }
}

const SHOWN = new Set(['user-text', 'assistant-text', 'tool-use']);

// --- Bericht -----------------------------------------------------------------

interface LaneRender {
  head: string;
  lines: string[];
}

function renderLane(dl: DigestLane, lv: Level, childOf: Map<string, string>, f: Findings | undefined, count: { n: number }): LaneRender {
  const { lane, entries } = dl;
  const results = new Map<string, ToolResultEntry>();
  for (const e of entries) if (e.kind === 'tool-result') results.set(e.toolUseId, e);
  const seenMsg = new Set<string>();
  const lines: string[] = [];
  const R = (t: string) => redact(t, count);
  const name = lane.kind === 'main' ? 'main agent' : lane.kind === 'subagent' ? `subagent ${lane.label}` : `spawned claude session ${lane.label}`;

  let day = '';
  for (const e of entries) {
    const d = e.timestamp ? new Date(e.timestamp).toDateString() : '';
    if (d && d !== day && SHOWN.has(e.kind)) {
      day = d;
      lines.push(`--- ${new Date(e.timestamp!).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })} ---`);
    }
    // Kosten und Kontextgröße je Modellantwort (einmal pro Message)
    let turn = '';
    if ((e.kind === 'assistant-text' || e.kind === 'thinking' || e.kind === 'tool-use') && e.usage && e.messageId && !seenMsg.has(e.messageId) && e.model !== '<synthetic>') {
      seenMsg.add(e.messageId);
      const t = emptyTotals();
      addUsage(t, e.usage);
      const ctx = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
      if (f) {
        f.maxContext = Math.max(f.maxContext, ctx);
        f.cacheRead += t.cacheRead;
        f.inputAll += ctx;
      }
      const c = estimateCost(e.model, t) ?? 0;
      if (c >= 0.02) turn = ` {${usd(c)}, ctx ${kTok(ctx)}}`;
    }
    const at = `[${time(e.timestamp)}]`;
    switch (e.kind) {
      case 'user-text': {
        if (e.isMeta || !e.text) break;
        if (e.isCompactSummary) {
          lines.push(`${at} [context was compacted – earlier conversation summarized]`);
          if (f) f.compactions++;
          break;
        }
        if (e.text.startsWith('<')) {
          const cmd = /<command-name>([^<]+)<\/command-name>/.exec(e.text);
          if (cmd) lines.push(`${at} USER ran ${cmd[1]}`);
          break;
        }
        lines.push(`${at} USER:\n${R(block(e.text, lv.prompt))}`);
        break;
      }
      case 'assistant-text':
        if (e.isApiError) lines.push(`${at} API ERROR: ${R(oneLine(e.text, 300))}`);
        else if (e.text.trim()) lines.push(`${at} ASSISTANT${turn}: ${R(block(e.text, lv.text))}`);
        else if (turn) lines.push(`${at} ASSISTANT${turn}`);
        break;
      case 'thinking':
        if (turn) lines.push(`${at} (thinking)${turn}`);
        break;
      case 'tool-use': {
        const r = results.get(e.toolUseId);
        f?.tool(lane.kind === 'main' ? 'main' : lane.label, e, r, count);
        let status = 'no result';
        if (r) {
          const took = r.timestamp && e.timestamp ? ` ${dur(Date.parse(r.timestamp) - Date.parse(e.timestamp))}` : '';
          const text = resultText(r);
          if (r.denied) status = `DENIED${took}: ${R(oneLine(r.denied, lv.err))}`;
          else if (r.isError) status = `ERROR${took}: ${R(oneLine(text, lv.err))}`;
          else status = `ok${took}${text.length > 200 ? `, ${text.length} chars` : ''}${lv.ok ? `: ${R(oneLine(text, lv.ok))}` : ''}`;
        }
        const child = childOf.get(e.toolUseId);
        lines.push(`${at} TOOL ${e.name}${turn}: ${R(toolDetail(e, lv))} → ${status}${child ? ` ⇒ started ${child}` : ''}`);
        break;
      }
      case 'system':
        if (e.subtype === 'compact_boundary') {
          lines.push(`${at} [context compacted]`);
          if (f) f.compactions++;
        }
        break;
    }
  }
  const span = lane.start && lane.end ? `, ${dur(lane.end - lane.start)}` : '';
  const head = `## Agent: ${name}${lane.sublabel ? ` – ${R(oneLine(lane.sublabel, 160))}` : ''}\n(${lane.model ?? 'unknown model'}, ${lane.toolCalls} tool calls, ${kTok(lane.outputTokens)} output tokens, est. ${usd(dl.costUSD)}${span}, status ${lane.status})`;
  return { head, lines };
}

export function buildDigest(input: DigestInput, opts: { full?: boolean } = {}): { text: string; stats: DigestStats } {
  const levels = opts.full ? FULL_LEVELS : LEVELS;
  const maxChars = opts.full ? FULL_MAX_CHARS : MAX_CHARS;
  const childOf = new Map<string, string>();
  const labelOf = new Map(input.lanes.map((l) => [l.lane.id, l.lane.kind === 'main' ? 'main agent' : `${l.lane.kind === 'spawn' ? 'claude session' : 'subagent'} "${l.lane.label}"`]));
  for (const { lane } of input.lanes) if (lane.viaToolUseId) childOf.set(lane.viaToolUseId, labelOf.get(lane.id)!);

  const tree = input.lanes
    .map(({ lane, costUSD }) => `${'  '.repeat(lane.depth)}- ${labelOf.get(lane.id)}${lane.sublabel ? ` (${oneLine(lane.sublabel, 80)})` : ''}: ${lane.model ?? '?'}, ${lane.toolCalls} tool calls, est. ${usd(costUSD)}, ${lane.status}`)
    .join('\n');
  const starts = input.lanes.map((l) => l.lane.start).filter((x): x is number => !!x);
  const ends = input.lanes.map((l) => l.lane.end).filter((x): x is number => !!x);
  const from = starts.length ? Math.min(...starts) : undefined;
  const to = ends.length ? Math.max(...ends) : undefined;

  let truncated = false;
  let result: { text: string; stats: DigestStats } | undefined;
  for (let li = 0; li < levels.length; li++) {
    const count = { n: 0 };
    const f = new Findings();
    const lanes = input.lanes.map((l) => renderLane(l, levels[li], childOf, f, count));
    let body = lanes.map((l) => `${l.head}\n\n${l.lines.join('\n')}`).join('\n\n');
    const last = li === levels.length - 1;
    if (body.length > maxChars && !last) {
      truncated = true;
      continue;
    }
    if (body.length > maxChars) {
      // Notfalls die Mitte langer Lanes auslassen: Anfang und Ende sind meist am aufschlussreichsten
      const total = lanes.reduce((a, l) => a + l.lines.length, 0);
      const avg = body.length / Math.max(1, total);
      const keep = Math.floor(maxChars / avg);
      body = lanes
        .map((l) => {
          const k = Math.max(20, Math.floor((keep * l.lines.length) / total));
          if (l.lines.length <= k) return `${l.head}\n\n${l.lines.join('\n')}`;
          const head = Math.ceil(k * 0.4);
          const tail = k - head;
          return `${l.head}\n\n${[...l.lines.slice(0, head), `… [${l.lines.length - k} entries omitted for length] …`, ...l.lines.slice(-tail)].join('\n')}`;
        })
        .join('\n\n');
    }
    const meta = [
      `# Claude Code session digest`,
      '',
      `- Title: ${redact(input.title ?? '(untitled)', count)}`,
      `- Project: ${input.project}${input.cwd ? ` (${tildify(input.cwd)})` : ''}${input.gitBranch ? `, branch ${input.gitBranch}` : ''}`,
      from ? `- Time: ${new Date(from).toLocaleString('en-GB')} – ${to ? new Date(to).toLocaleString('en-GB') : 'now'}${to ? ` (${dur(to - from)})` : ''}` : undefined,
      `- Estimated cost of the whole tree (API list prices): ${usd(input.costUSD)}`,
      `- Format: one line per event. [hh:mm:ss] USER / ASSISTANT / TOOL <name>: <input> → <result status, duration>. {$cost, ctx N} = cost and context size of that model response (shown from $0.02). Texts and outputs are shortened${truncated ? ' strongly, because the session is long' : ''}.${opts.full ? ' Bash commands are given in full in ```sh blocks; Write contents between <<<CONTENT/CONTENT, Edit replacements between <<<OLD/OLD and <<<NEW/NEW (long ones shortened).' : ''}`,
      '',
      '## Agent tree',
      tree,
      '',
      '## Automatic observations (computed, not judged)',
      f.render(count.n),
      '',
    ]
      .filter((x) => x !== undefined)
      .join('\n');
    const text = `${meta}\n\n${body}\n`;
    result = {
      text,
      stats: { chars: text.length, tokens: Math.round(text.length / 3.5), agents: input.lanes.length, toolCalls: f.toolCalls, redactions: count.n, truncated: truncated || text.includes('entries omitted for length') },
    };
    break;
  }
  return result!;
}
