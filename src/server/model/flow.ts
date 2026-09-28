import type { Entry, FlowLane, FlowSpan } from '../../shared/types.js';
import { toolSummary } from '../../shared/tools.js';

type LaneData = Pick<FlowLane, 'spans' | 'turns' | 'start' | 'end' | 'toolCalls' | 'outputTokens' | 'model'>;

/** Tool-Spannen, Antwortzeitpunkte und Zeitraum eines Transcripts. */
export function laneData(entries: Entry[]): LaneData {
  const spans: FlowSpan[] = [];
  const byId = new Map<string, FlowSpan>();
  const turns: number[] = [];
  const outByMsg = new Map<string, number>();
  let start: number | undefined;
  let end: number | undefined;
  let model: string | undefined;
  for (const e of entries) {
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    if (e.kind === 'meta' || e.kind === 'attachment') continue;
    start = start === undefined ? ts : Math.min(start, ts);
    end = end === undefined ? ts : Math.max(end, ts);
    if (e.kind === 'tool-use') {
      // Fortgesetzte/geforkte Sessions enthalten Records teils doppelt
      if (byId.has(e.toolUseId)) continue;
      const s: FlowSpan = { toolUseId: e.toolUseId, name: e.name, summary: toolSummary(e.name, e.input).slice(0, 160), start: ts };
      spans.push(s);
      byId.set(e.toolUseId, s);
    } else if (e.kind === 'tool-result') {
      const s = byId.get(e.toolUseId);
      if (s) {
        s.end = Math.max(ts, s.start);
        if (e.isError || e.denied) s.isError = true;
      }
    }
    if ((e.kind === 'assistant-text' || e.kind === 'tool-use' || e.kind === 'thinking') && e.messageId) {
      if (!outByMsg.has(e.messageId)) turns.push(ts);
      outByMsg.set(e.messageId, e.usage?.output_tokens ?? 0);
      if (e.model && e.model !== '<synthetic>') model = e.model;
    }
  }
  let outputTokens = 0;
  for (const v of outByMsg.values()) outputTokens += v;
  return { spans, turns, start, end, toolCalls: spans.length, outputTokens, model };
}
