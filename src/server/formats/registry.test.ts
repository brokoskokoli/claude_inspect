import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entry } from '../../shared/types.js';
import { registry } from './index.js';
import type { DecodedEntry } from './transcript/common.js';

const decode = (raw: unknown) => registry.decode<DecodedEntry[]>('transcript', raw, 'test.jsonl');

test('assistant record with text and tool call', () => {
  const { out, decoder } = decode({
    type: 'assistant',
    uuid: 'u1',
    version: '2.1.283',
    timestamp: '2026-09-28T10:00:00Z',
    message: {
      model: 'claude-opus-5-5',
      id: 'msg_1',
      content: [
        { type: 'text', text: 'Hallo' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  });
  assert.equal(decoder, 'transcript.message@2');
  assert.deepEqual(out.map((e) => e.kind), ['assistant-text', 'tool-use']);
  const use = out[1] as Extract<Entry, { kind: 'tool-use' }>;
  assert.equal(use.name, 'Bash');
  assert.equal(use.model, 'claude-opus-5-5');
});

test('user record: string content (older versions) and tool_result with structured result', () => {
  assert.equal(decode({ type: 'user', message: { role: 'user', content: 'hi' }, version: '2.1.72' }).out[0].kind, 'user-text');
  const { out } = decode({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }] },
    toolUseResult: { stdout: 'ok', stderr: '', originalFile: 'x'.repeat(100) },
  });
  const r = out[0] as Extract<Entry, { kind: 'tool-result' }>;
  assert.equal(r.kind, 'tool-result');
  assert.equal(r.toolUseId, 'toolu_1');
  // ganze Dateiinhalte werden nicht mitgeschickt
  assert.match(String((r.structured as Record<string, unknown>).originalFile), /omitted/);
});

test('unknown record type goes to the fallback and the drift report', () => {
  const { out, decoder } = decode({ type: 'future-thing', foo: 1, version: '9.9.9' });
  assert.equal(decoder, 'transcript.fallback');
  assert.equal(out[0].kind, 'unknown');
  const drift = registry.report().drift.find((d) => d.recordType === 'future-thing');
  assert.equal(drift?.firstVersion, '9.9.9');
});

test('unknown fields are kept as extra', () => {
  const { out } = decode({ type: 'user', message: { role: 'user', content: 'x' }, brandNewField: 42 });
  assert.deepEqual(out[0].extra, { brandNewField: 42 });
});

test('secrets are masked', () => {
  const { out } = decode({ type: 'attachment', attachment: { type: 'x', authToken: 'secret-value', totalTokens: 5 } });
  const a = out[0] as Extract<Entry, { kind: 'attachment' }>;
  assert.notEqual(a.data.authToken, 'secret-value');
  assert.equal(a.data.totalTokens, 5);
});

test('process file: new and old variant', () => {
  const v2 = registry.decode('process', { pid: 1, sessionId: 's', status: 'busy', version: '2.1.283' }, 'p.json');
  const v1 = registry.decode('process', { pid: 1, sessionId: 's', version: '2.1.114' }, 'p.json');
  assert.equal(v2.decoder, 'process.session-file@2');
  assert.equal(v1.decoder, 'process.session-file@1');
});
