import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HistoryIndex } from '../src/server/history/aggregator.js';

const T = (s: number) => new Date(Date.UTC(2026, 8, 28, 10, 0, s)).toISOString();
const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
const records = [
  { type: 'user', uuid: 'u1', timestamp: T(0), version: '2.1.283', message: { role: 'user', content: 'Bitte baue X' } },
  // dieselbe Message-Id in zwei Records (Text + Tool-Aufruf) → Usage nur einmal zählen
  { type: 'assistant', uuid: 'a1', timestamp: T(1), message: { id: 'msg_1', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'ok' }], usage } },
  { type: 'assistant', uuid: 'a2', timestamp: T(2), message: { id: 'msg_1', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 'toolu_a', name: 'Edit', input: { file_path: '/r/a.ts', old_string: 'a', new_string: 'b' } }], usage } },
  { type: 'user', uuid: 'u2', timestamp: T(5), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'fail', is_error: true }] } },
  // doppelter Record (wie nach Resume) darf nicht doppelt zählen
  { type: 'assistant', uuid: 'a2', timestamp: T(2), message: { id: 'msg_1', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 'toolu_a', name: 'Edit', input: { file_path: '/r/a.ts' } }], usage } },
];

test('aggregiert Tokens, Kosten, Tool-Dauer und Dateien', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-agg-'));
  const path = join(dir, 's1.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const h = new HistoryIndex();
  await h.refresh([{ sessionId: 's1', projectDir: 'p', path, size: 1, mtime: Date.now() }], async () => 'demo', true);

  const s = h.stats({});
  assert.equal(s.totals.tokens.output, 100, 'Usage je Message-Id nur einmal');
  assert.equal(s.totals.prompts, 1);
  assert.equal(s.totals.toolCalls, 1);
  assert.equal(s.byModel[0].model, 'claude-sonnet-5');
  // Sonnet 5: 10×$2 + 100×$10 + 1000×$0,20 pro Mio.
  assert.ok(Math.abs(s.totals.costUSD - (10 * 2 + 100 * 10 + 1000 * 0.2) / 1e6) < 1e-12);
  assert.deepEqual(s.tools.map((t) => [t.name, t.count, t.errors]), [['Edit', 1, 1]]);

  const calls = h.toolCalls({ name: 'Edit' });
  assert.equal(calls.rows[0].durationMs, 3000);
  assert.equal(calls.rows[0].isError, true);

  const files = h.fileStats({});
  assert.deepEqual(files.files.map((f) => [f.path, f.edits]), [['/r/a.ts', 1]]);
});
