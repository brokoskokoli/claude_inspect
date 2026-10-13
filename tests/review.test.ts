import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest, redact } from '../src/server/review/digest.js';
import type { Entry, FlowLane } from '../src/shared/types.js';

test('redact masks common secrets and counts them', () => {
  const n = { n: 0 };
  const out = redact(
    'key sk-ant-api03-abcdefghijklmnop, ghp_abcdefghijklmnopqrstuvwxyz0123, Authorization: Bearer abcdefghijklmnopqrstuv, password=hunter2hunter, https://bob:s3cr3tpw@example.com',
    n,
  );
  assert.ok(!/sk-ant-api03|ghp_abc|hunter2|s3cr3tpw|Bearer abcdef/.test(out), out);
  assert.equal(n.n, 5);
  assert.equal(redact('input_tokens: 123456 and a normal sentence', { n: 0 }), 'input_tokens: 123456 and a normal sentence');
});

test('buildDigest lists tool calls, errors and automatic observations', () => {
  const ts = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
  let seq = 0;
  const base = (kind: string, s: number, extra: object) => ({ seq: seq++, line: seq, kind, decoder: 't', recordType: 'x', timestamp: ts(s), ...extra }) as unknown as Entry;
  const use = (id: string, s: number, name: string, input: object) => base('tool-use', s, { toolUseId: id, name, input });
  const res = (id: string, s: number, text: string, isError = false) => base('tool-result', s, { toolUseId: id, parts: [{ type: 'text', text }], isError });
  const entries: Entry[] = [
    base('user-text', 0, { text: 'Fix the deploy script' }),
    use('a', 1, 'Read', { file_path: '/repo/.env' }),
    res('a', 2, 'API_KEY=sk-ant-api03-zzzzzzzzzzzzzzzz'),
    use('b', 3, 'Bash', { command: 'npm test' }),
    res('b', 5, 'failed', true),
    use('c', 6, 'Bash', { command: 'npm test' }),
    res('c', 8, 'failed', true),
    use('d', 9, 'Bash', { command: 'git push --force origin main' }),
    res('d', 10, 'ok'),
  ];
  const lane: FlowLane = { id: 's', sessionId: 's', kind: 'main', label: 'main', depth: 0, status: 'done', spans: [], turns: [], toolCalls: 4, outputTokens: 0 };
  const { text, stats } = buildDigest({ project: 'repo', costUSD: 0.5, lanes: [{ lane, entries, costUSD: 0.5 }] });
  assert.equal(stats.toolCalls, 4);
  assert.ok(text.includes('USER:\nFix the deploy script'));
  assert.ok(text.includes('TOOL Bash: npm test → ERROR'));
  assert.ok(/2× main: Bash npm test/.test(text), 'repeated failure');
  assert.ok(text.includes('possibly sensitive files'));
  assert.ok(text.includes('Risky pattern "force push"'));
  assert.ok(text.includes('Commands that send data out'));
  assert.ok(!text.includes('zzzzzzzz'), 'secret in tool output masked');
});
