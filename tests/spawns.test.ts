import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeInvocations, parseCall, scoreSpawn, type ChildInfo } from '../src/server/sources/spawns.js';

const call = (command: string, ts = '2026-09-28T10:00:00.000Z', cwd = '/repo') =>
  parseCall({ timestamp: ts, cwd }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }, 'parent');

test('erkennt claude-Aufrufe, auch mehrere und mit Wrapper', () => {
  assert.equal(claudeInvocations('cd x && caffeinate -i claude --agent coder -p "a"; claude -p "b"').length, 2);
  assert.equal(call('ls ~/.claude/projects').length, 0, '.claude-Pfad ist kein Aufruf');
  assert.equal(call('claude --version && which claude').length, 0, 'Versionsabfrage erzeugt keine Sitzung');
  assert.equal(call('npx claude-inspect').length, 0);
  assert.equal(call('/usr/local/bin/claude -p "hi"').length, 1);
});

test('liest --agent und --session-id', () => {
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

test('Prompt im Befehl + Agent + Zeit → sicher', () => {
  const prompt = 'Spec: docs/specs/0042-search.md Item: ISSUE-17. Auftrag: nur Teil 1 nach §7 der Spec, je mit Gate und eigenem Commit.';
  const [c] = call(`cd /repo && claude --agent coder -p "${prompt.replace(/"/g, '\\"')}" --output-format json`);
  const r = scoreSpawn(child({ prompt, agentSetting: 'coder' }), c);
  assert.ok(r.score >= 70, JSON.stringify(r));
  assert.ok(r.evidence.includes('Prompt') && r.evidence.includes('Agent'));
});

test('falscher Agent wird abgewertet', () => {
  const prompt = 'Mach etwas Bestimmtes mit dem Repository und schreibe einen Bericht darüber.';
  const [c] = call(`claude --agent reviewer -p "${prompt}"`);
  const good = scoreSpawn(child({ prompt, agentSetting: 'reviewer' }), c).score;
  const bad = scoreSpawn(child({ prompt, agentSetting: 'coder' }), c).score;
  assert.ok(good - bad >= 40);
});

test('kurzer Prompt nur als exaktes -p-Argument', () => {
  const [c] = call('claude -p "/usage" --output-format json');
  assert.ok(scoreSpawn(child({ prompt: '/usage' }), c).evidence.includes('Prompt'));
  const [d] = call('claude -p "/usage-report"');
  assert.ok(!scoreSpawn(child({ prompt: '/usage' }), d).evidence.includes('Prompt'));
});

test('Session-Id im Befehl ist exakt', () => {
  const [c] = call('claude --resume 12345678-1234-1234-1234-123456789abc -p "weiter"');
  assert.equal(scoreSpawn(child({ sessionId: '12345678-1234-1234-1234-123456789abc' }), c).score, 1000);
});
