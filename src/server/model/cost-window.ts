import { addUsage, emptyTotals, estimateCost, priceFor, type TokenTotals } from '../../shared/pricing.js';
import { toolSummary } from '../../shared/tools.js';
import type { CostInput, CostRequest, CostSplit, CostWindow, Entry, FlowLane, ToolUseEntry, Usage } from '../../shared/types.js';

/**
 * Was in einem Zeitfenster Geld gekostet hat, Anfrage für Anfrage.
 *
 * Kosten entstehen nur bei Modell-Anfragen. Jede zahlt dafür, den bisherigen Kontext erneut zu
 * lesen (meist der größte Posten), für neu hinzugekommenen Kontext (vor allem das Ergebnis des
 * vorigen Tool-Aufrufs) und für die eigene Antwort. Darum steht zu jeder Anfrage, was sie getan
 * hat und was vorher in den Kontext kam – und zu jedem Zugang, wie oft er danach noch
 * mitgelesen wurde (bis zur nächsten Komprimierung) und was das kostete. Viel mehr neuer Kontext
 * als hinzukam heißt: Der Cache wurde neu aufgebaut – nach einer Pause, oder weil sich Tools
 * bzw. der Systemprompt geändert haben.
 */

const CHARS_PER_TOKEN = 3.5;
const MAX_ITEMS = 200;
const SUMMARY = 160;
/** ab so viel neuem Kontext ohne passenden Zugang gilt der Cache als neu aufgebaut */
const REBUILD_MIN = 20_000;

function costSplit(model: string, t: TokenTotals): { cost: CostSplit; tokens: CostSplit } {
  const part = (p: Partial<TokenTotals>) => estimateCost(model, { ...emptyTotals(), ...p }) ?? 0;
  return {
    cost: { context: part({ cacheRead: t.cacheRead }), added: part({ input: t.input, cacheWrite5m: t.cacheWrite5m, cacheWrite1h: t.cacheWrite1h }), output: part({ output: t.output }) },
    tokens: { context: t.cacheRead, added: t.input + t.cacheWrite5m + t.cacheWrite1h, output: t.output },
  };
}

/** USD je Token, um bereits gecachten Kontext zu lesen */
function rereadPrice(model: string): number {
  const p = priceFor(model);
  return p ? (p.cacheRead ?? p.input * 0.1) / 1_000_000 : 0;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, SUMMARY);

interface Built extends CostRequest {
  usage?: Usage;
  /** Abschnitt zwischen zwei Komprimierungen */
  segment: number;
}

/** Alle Anfragen eines Agenten in zeitlicher Reihenfolge. `seen`: Message-Ids, die schon gezählt sind (Resume/Fork). */
export function requestsOf(lane: FlowLane, entries: Entry[], seen: Set<string>): CostRequest[] {
  const calls = new Map<string, ToolUseEntry>();
  const byMessage = new Map<string, Built | null>();
  const out: Built[] = [];
  let pending: CostInput[] = [];
  let segment = 0;
  const input = (kind: CostInput['kind'], summary: string, chars: number, line: number, extra: Partial<CostInput> = {}) => {
    if (chars > 0) pending.push({ kind, summary, chars, tokens: Math.round(chars / CHARS_PER_TOKEN), line, rereads: 0, rereadUSD: 0, ...extra });
  };

  for (const e of entries) {
    if (e.kind === 'assistant-text' || e.kind === 'thinking' || e.kind === 'tool-use') {
      if (e.kind === 'tool-use') calls.set(e.toolUseId, e);
      if (!e.messageId) continue;
      let r = byMessage.get(e.messageId);
      if (r === undefined) {
        if (seen.has(e.messageId)) {
          byMessage.set(e.messageId, null);
          continue;
        }
        seen.add(e.messageId);
        r = {
          laneId: lane.id,
          sessionId: lane.sessionId,
          agentId: lane.agentId,
          ts: e.timestamp ?? '',
          model: e.model ?? '',
          costUSD: 0,
          split: { context: 0, added: 0, output: 0 },
          tokens: { context: 0, added: 0, output: 0 },
          actions: [],
          inputs: pending,
          line: e.line,
          segment,
        };
        pending = [];
        byMessage.set(e.messageId, r);
        out.push(r);
      }
      if (!r) continue;
      if (e.usage) r.usage = e.usage;
      if (e.model) r.model = e.model;
      if (e.kind === 'tool-use') r.actions.push({ name: e.name, summary: oneLine(toolSummary(e.name, e.input)), toolUseId: e.toolUseId });
      else if (e.kind === 'assistant-text' && e.text.trim()) r.actions.push({ summary: oneLine(e.text) });
      continue;
    }
    switch (e.kind) {
      case 'tool-result': {
        const call = calls.get(e.toolUseId);
        let chars = 0;
        for (const p of e.parts) if (p.type === 'text') chars += p.text.length + (p.truncated ?? 0);
        input('tool-result', call ? oneLine(toolSummary(call.name, call.input)) : 'tool result', chars, e.line, { name: call?.name ?? '?', toolUseId: e.toolUseId });
        break;
      }
      case 'user-text':
        if (e.isCompactSummary) {
          segment++;
          input('other', 'Summary after compaction', e.text.length, e.line);
        } else if (e.isMeta || e.text.startsWith('<')) input('other', oneLine(e.text), e.text.length, e.line);
        else input('prompt', oneLine(e.text), e.text.length, e.line);
        break;
    }
  }

  const done = out.filter((r) => r.usage && r.model && r.model !== '<synthetic>');
  for (const r of done) {
    const t = emptyTotals();
    addUsage(t, r.usage!);
    const s = costSplit(r.model, t);
    r.split = s.cost;
    r.tokens = s.tokens;
    r.costUSD = s.cost.context + s.cost.added + s.cost.output;
    const arrived = r.inputs.reduce((n, x) => n + x.tokens, 0);
    if (r.tokens.added > REBUILD_MIN && r.tokens.added > 3 * arrived) r.cacheRebuild = true;
  }
  // Folgekosten: jeder Zugang wird von allen späteren Anfragen im selben Abschnitt mitgelesen
  let later = 0;
  let laterUSD = 0;
  for (let i = done.length - 1; i >= 0; i--) {
    const r = done[i];
    if (i < done.length - 1 && done[i + 1].segment !== r.segment) later = laterUSD = 0;
    for (const x of r.inputs) {
      x.rereads = later;
      x.rereadUSD = x.tokens * laterUSD;
    }
    later++;
    laterUSD += rereadPrice(r.model);
  }
  for (const r of done) r.inputs.sort((a, b) => b.chars - a.chars);
  return done.map(({ usage: _u, segment: _s, ...r }) => r);
}

/** Zusammenfassung und Anfragen im Fenster [from, to) über alle Agenten des Baums. */
export function costWindow(lanes: { lane: FlowLane; entries: Entry[] }[], from: number, to: number): CostWindow {
  const seen = new Set<string>();
  const items: CostRequest[] = [];
  const split: CostSplit = { context: 0, added: 0, output: 0 };
  const tokens: CostSplit = { context: 0, added: 0, output: 0 };
  const rebuilds = { count: 0, costUSD: 0 };
  const byAgent = new Map<string, CostWindow['byAgent'][number]>();
  const byAction = new Map<string, CostWindow['byAction'][number]>();
  const inputs: CostWindow['topInputs'] = [];
  for (const { lane, entries } of lanes) {
    for (const r of requestsOf(lane, entries, seen)) {
      const ts = Date.parse(r.ts);
      if (!(ts >= from && ts < to)) continue;
      items.push(r);
      split.context += r.split.context;
      split.added += r.split.added;
      split.output += r.split.output;
      tokens.context += r.tokens.context;
      tokens.added += r.tokens.added;
      tokens.output += r.tokens.output;
      if (r.cacheRebuild) {
        rebuilds.count++;
        rebuilds.costUSD += r.split.added;
      }
      let a = byAgent.get(lane.id);
      if (!a) {
        const { id, sessionId, agentId, label, sublabel, kind } = lane;
        byAgent.set(lane.id, (a = { id, sessionId, agentId, label, sublabel, kind, costUSD: 0, requests: 0, line: r.line, ts: r.ts }));
      }
      if (r.ts < a.ts) [a.line, a.ts] = [r.line, r.ts];
      a.costUSD += r.costUSD;
      a.requests++;
      // eine Antwort mit mehreren Tool-Aufrufen zählt anteilig bei jedem
      const names = r.actions.some((x) => x.name) ? r.actions.filter((x) => x.name).map((x) => x.name!) : ['Text'];
      for (const n of names) {
        let b = byAction.get(n);
        if (!b) byAction.set(n, (b = { name: n, costUSD: 0, requests: 0 }));
        b.costUSD += r.costUSD / names.length;
        b.requests += 1 / names.length;
      }
      for (const x of r.inputs) inputs.push({ ...x, laneId: lane.id, sessionId: lane.sessionId, agentId: lane.agentId, label: lane.label });
    }
  }
  const costUSD = split.context + split.added + split.output;
  return {
    from,
    to,
    costUSD,
    requests: items.length,
    split,
    tokens,
    rebuilds,
    byAgent: [...byAgent.values()].sort((a, b) => b.costUSD - a.costUSD),
    byAction: [...byAction.values()].map((b) => ({ ...b, requests: Math.round(b.requests) })).sort((a, b) => b.costUSD - a.costUSD),
    topInputs: inputs.sort((a, b) => b.tokens * (1 + b.rereads) - a.tokens * (1 + a.rereads)).slice(0, 12),
    items: items.sort((a, b) => b.costUSD - a.costUSD).slice(0, MAX_ITEMS),
  };
}
