import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costWindow } from '../src/server/model/cost-window.js';
import type { Entry, FlowLane } from '../src/shared/types.js';

const T = (s: number) => new Date(Date.UTC(2026, 9, 26, 10, 0, s)).toISOString();
const lane: FlowLane = { id: 's1', sessionId: 's1', kind: 'main', label: 'Main', depth: 0, status: 'done', spans: [], turns: [], toolCalls: 0, outputTokens: 0 };
const base = (line: number, s: number) => ({ seq: line, line, decoder: 't', recordType: 'x', timestamp: T(s) });
// Opus 5.5: $4 Input, $20 Output, $0,20 Cache lesen je Mio.; 1h-Cache schreiben = 2 × Input
const usage = (read: number, write: number, out: number) => ({ input_tokens: 0, output_tokens: out, cache_read_input_tokens: read, cache_creation: { ephemeral_1h_input_tokens: write, ephemeral_5m_input_tokens: 0 } });
const msg = (line: number, s: number, id: string, u: ReturnType<typeof usage>) => ({ ...base(line, s), model: 'claude-opus-5-5', messageId: id, usage: u });

const entries = [
  { ...base(0, 0), kind: 'user-text', text: 'Bitte prüfen' },
  { ...msg(1, 1, 'm1', usage(100_000, 1_000, 500)), kind: 'tool-use', toolUseId: 't1', name: 'Read', input: { file_path: '/r/big.json' } },
  { ...base(2, 2), kind: 'tool-result', toolUseId: 't1', parts: [{ type: 'text', text: 'x'.repeat(35_000) }], isError: false },
  { ...msg(3, 3, 'm2', usage(101_000, 10_000, 200)), kind: 'assistant-text', text: 'Fertig gelesen' },
  { ...msg(4, 4, 'm3', usage(111_000, 100, 100)), kind: 'assistant-text', text: 'Noch etwas' },
  { ...base(5, 5), kind: 'user-text', text: 'Zusammenfassung', isCompactSummary: true },
  { ...msg(6, 6, 'm4', usage(5_000, 0, 100)), kind: 'assistant-text', text: 'Nach der Komprimierung' },
] as Entry[];

test('cost window: split per request, additions to the context and their follow-up cost', () => {
  const w = costWindow([{ lane, entries }], Date.parse(T(0)), Date.parse(T(10)));
  assert.equal(w.requests, 4);
  const m2 = w.items.find((r) => r.line === 3)!;
  assert.ok(Math.abs(m2.split.context - (101_000 * 0.2) / 1e6) < 1e-12);
  assert.ok(Math.abs(m2.split.added - (10_000 * 8) / 1e6) < 1e-12);
  assert.ok(Math.abs(m2.split.output - (200 * 20) / 1e6) < 1e-12);
  assert.deepEqual(m2.tokens, { context: 101_000, added: 10_000, output: 200 });

  // vor m2 kam das Read-Ergebnis in den Kontext: 35.000 Zeichen ≈ 10.000 Tokens,
  // danach von m3 noch einmal mitgelesen, m4 liegt hinter der Komprimierung
  assert.equal(m2.inputs.length, 1);
  assert.equal(m2.inputs[0].name, 'Read');
  assert.equal(m2.inputs[0].tokens, 10_000);
  assert.equal(m2.inputs[0].rereads, 1);
  assert.ok(Math.abs(m2.inputs[0].rereadUSD - (10_000 * 0.2) / 1e6) < 1e-12);

  const m1 = w.items.find((r) => r.line === 1)!;
  assert.deepEqual(m1.actions.map((a) => a.name), ['Read']);
  assert.equal(m1.inputs[0].kind, 'prompt');
  assert.equal(m1.inputs[0].rereads, 2, 'the prompt is read by m2 and m3');

  assert.deepEqual(
    w.byAgent.map((a) => [a.sessionId, a.line, a.requests]),
    [['s1', 1, 4]],
    'each agent links to its first request in the window',
  );
  assert.deepEqual(w.byAction.map((a) => [a.name, a.requests]), [['Text', 3], ['Read', 1]]);
  assert.equal(w.topInputs[0].name, 'Read');
  assert.ok(Math.abs(w.costUSD - w.items.reduce((s, r) => s + r.costUSD, 0)) < 1e-12);
});

test('cost window: only requests inside the window, duplicates (resume/fork) once', () => {
  const w = costWindow([{ lane, entries }], Date.parse(T(2)), Date.parse(T(4)));
  assert.deepEqual(w.items.map((r) => r.line), [3]);
  // dieselben Messages in einer zweiten Lane (fortgesetzte Session) zählen nicht doppelt
  const twice = costWindow([{ lane, entries }, { lane: { ...lane, id: 's2', sessionId: 's2' }, entries }], 0, Date.parse(T(10)));
  assert.equal(twice.requests, 4);
});

test('cost window: a request that writes far more context than arrived is a cache rebuild', () => {
  const more = [...entries, { ...msg(7, 7, 'm5', usage(0, 300_000, 50)), kind: 'assistant-text', text: 'Nach Pause' }] as Entry[];
  const w = costWindow([{ lane, entries: more }], 0, Date.parse(T(10)));
  assert.equal(w.items.find((r) => r.line === 7)?.cacheRebuild, true);
  assert.equal(w.items.find((r) => r.line === 3)?.cacheRebuild, undefined, '10k tokens written after a 10k-token read result is normal');
  assert.equal(w.rebuilds.count, 1);
  assert.ok(Math.abs(w.rebuilds.costUSD - (300_000 * 8) / 1e6) < 1e-12);
});
