import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeInvocations, parseCall, scoreSpawn, type ChildInfo } from '../src/server/sources/spawns.js';

const call = (command: string, ts = '2026-09-28T10:00:00.000Z', cwd = '/repo') =>
  parseCall({ timestamp: ts, cwd }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }, 'parent');

test('detects claude invocations, multiple and with wrappers', () => {
  assert.equal(claudeInvocations('cd x && caffeinate -i claude --agent coder -p "a"; claude -p "b"').length, 2);
  assert.equal(call('ls ~/.claude/projects').length, 0, 'a .claude path is not a call');
  assert.equal(call('claude --version && which claude').length, 0, 'a version check creates no session');
  assert.equal(call('npx claude-inspect').length, 0);
  assert.equal(call('/usr/local/bin/claude -p "hi"').length, 1);
});

test('reads --agent and --session-id', () => {
  const [c] = call('claude --agent impl-agent --session-id 12345678-1234-1234-1234-123456789abc -p "x"');
  assert.equal(c.agentFlag, 'impl-agent');
  assert.deepEqual(c.sessionFlags, ['12345678-1234-1234-1234-123456789abc']);
});

const child = (over: Partial<ChildInfo>): ChildInfo => ({
  sessionId: 'child',
  startTs: Date.parse('2026-09-28T10:00:03.000Z'),
  entrypoint: 'sdk-cli',
  promptSource: 'sdk',
  cwd: '/repo',
  ...over,
});

test('prompt in command + agent + time → high', () => {
  const prompt = 'Spec: docs/specs/0042-search.md Item: ISSUE-17. Task: only part 1 of section 7, each step with its own gate and commit.';
  const [c] = call(`cd /repo && claude --agent coder -p "${prompt.replace(/"/g, '\\"')}" --output-format json`);
  const r = scoreSpawn(child({ prompt, agentSetting: 'coder' }), c);
  assert.ok(r.score >= 70, JSON.stringify(r));
  assert.ok(r.evidence.includes('prompt') && r.evidence.includes('agent'));
});

test('a different agent lowers the score', () => {
  const prompt = 'Do something specific with the repository and write a report about it.';
  const [c] = call(`claude --agent reviewer -p "${prompt}"`);
  const good = scoreSpawn(child({ prompt, agentSetting: 'reviewer' }), c).score;
  const bad = scoreSpawn(child({ prompt, agentSetting: 'coder' }), c).score;
  assert.ok(good - bad >= 40);
});

test('a short prompt only counts as the exact -p argument', () => {
  const [c] = call('claude -p "/usage" --output-format json');
  assert.ok(scoreSpawn(child({ prompt: '/usage' }), c).evidence.includes('prompt'));
  const [d] = call('claude -p "/usage-report"');
  assert.ok(!scoreSpawn(child({ prompt: '/usage' }), d).evidence.includes('prompt'));
});

test('a session id in the command is exact', () => {
  const [c] = call('claude --resume 12345678-1234-1234-1234-123456789abc -p "weiter"');
  assert.equal(scoreSpawn(child({ sessionId: '12345678-1234-1234-1234-123456789abc' }), c).score, 1000);
});
