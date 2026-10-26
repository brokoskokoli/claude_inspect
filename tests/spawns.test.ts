import assert from 'node:assert/strict';
import { homedir } from 'node:os';
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

test('indirect start via a script that opens a terminal: name, directory and prompt in the command', () => {
  const prompt = 'Implement WP12: docs/work-packages/WP12-export.md. Worktree /home/me/shop-wt/wp12, branch wp/12-export.';
  const command = [
    'cd ~/shop && git worktree add -q ../shop-wt/wp12 -b wp/12-export main',
    `cat > ../shop-wt/handoff/wp12-prompt.md <<'EOF'\n${prompt}\nEOF`,
    '~/.claude/skills/dev-supervisor/scripts/start-wp-session.sh /home/me/shop-wt/wp12 "WP12 Export" ../shop-wt/handoff/wp12-prompt.md 2>&1 | tail -1',
  ].join('\n');
  const [c] = call(command, '2026-09-28T10:00:00.000Z', '/home/me/shop');
  assert.equal(c?.indirect, true);
  const interactive = child({ entrypoint: 'cli', promptSource: undefined, cwd: '/home/me/shop-wt/wp12', agentSetting: 'wp-supervisor', name: 'WP12 Export', prompt });
  const r = scoreSpawn(interactive, c);
  assert.ok(r.score >= 70, JSON.stringify(r));
  for (const e of ['name', 'directory in command', 'prompt', 'time']) assert.ok(r.evidence.includes(e), e);
  // die Agent-Definition setzt das Skript selbst – fehlt sie im Befehl, ist das kein Widerspruch
  assert.ok(!r.evidence.includes('agent'));
});

test('indirect start: directory and time alone are not enough for an interactive session', () => {
  const [c] = call('osascript -e \'tell application "Terminal" to do script "cd /home/me/shop-wt/wp13"\'');
  const r = scoreSpawn(child({ entrypoint: 'cli', promptSource: undefined, cwd: '/home/me/shop-wt/wp13', prompt: 'something entirely different typed by hand' }), c);
  assert.ok(r.score < 60, JSON.stringify(r));
  // a sibling directory must not count as the same directory
  assert.ok(!scoreSpawn(child({ cwd: '/home/me/shop-wt/wp1' }), c).evidence.includes('directory in command'));
});

test('ordinary commands are no launch candidates', () => {
  assert.equal(call('ls ~/.claude/projects && cat ~/.claude/settings.json').length, 0);
  assert.equal(call('npm test').length, 0);
});

test('indirect start with a relative worktree path and the agent as a plain script argument', () => {
  const [c] = call('cd ~/proj && ~/.claude/skills/x/scripts/start-wp-session.sh ../proj-wt/r4 "proj R4 Bench" ../proj-wt/handoff/r4.md bypassPermissions research-supervisor', '2026-09-28T10:00:00.000Z', '/elsewhere');
  const r = scoreSpawn(child({ entrypoint: 'cli', promptSource: undefined, cwd: `${homedir()}/proj-wt/r4`, agentSetting: 'research-supervisor', name: 'proj R4 Bench', prompt: 'Work on R4 as described in the handoff.' }), c);
  for (const e of ['name', 'directory in command', 'agent', 'time']) assert.ok(r.evidence.includes(e), `${e}: ${JSON.stringify(r)}`);
  assert.ok(r.score >= 70);
});
