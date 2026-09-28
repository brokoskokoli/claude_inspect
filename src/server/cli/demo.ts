/**
 * Demo mode: builds a completely fictional ~/.claude directory (running agents,
 * subagents, a `claude -p` spawned worker, tasks and two weeks of history) and
 * starts claude-inspect on it. Used for screenshots and for trying the tool
 * without real data.
 *
 *   claude-inspect demo              → generate into a temp dir and start the server
 *   claude-inspect demo --out DIR    → only generate into DIR (no processes, no server)
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ROOT = '';
const NOW = Date.now();
const VERSION = '2.1.283';

// ---------------------------------------------------------------------------
// deterministic pseudo-random numbers

// mulberry32 – kleiner, deterministischer 32-Bit-Generator
let seed = 42;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
let idc = 0;
const uuid = () => {
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-a${h(3)}-${h(12)}`;
};
const nextId = (p: string) => `${p}_demo${(++idc).toString(36).padStart(6, '0')}`;

const slug = (cwd: string) => cwd.replace(/[/_.]/g, '-');
const write = (path: string, data: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, data);
};

// ---------------------------------------------------------------------------
// transcript writer

interface Opts {
  sessionId: string;
  cwd: string;
  start: number;
  model: string;
  entrypoint?: string;
  agentId?: string;
  promptSource?: string;
}

type Result = { text: string; structured?: unknown; isError?: boolean; seconds?: number };

class Transcript {
  lines: unknown[] = [];
  t: number;
  parent: string | null = null;
  constructor(readonly o: Opts) {
    this.t = o.start;
  }
  private env(extra: Record<string, unknown> = {}) {
    const uuidV = uuid();
    const rec = {
      parentUuid: this.parent,
      isSidechain: !!this.o.agentId,
      userType: 'external',
      cwd: this.o.cwd,
      sessionId: this.o.sessionId,
      version: VERSION,
      gitBranch: 'main',
      entrypoint: this.o.entrypoint ?? 'cli',
      uuid: uuidV,
      timestamp: new Date(this.t).toISOString(),
      ...(this.o.agentId ? { agentId: this.o.agentId } : {}),
      ...extra,
    };
    this.parent = uuidV;
    return rec;
  }
  wait(s: number) {
    this.t += s * 1000;
    return this;
  }
  meta(type: string, data: Record<string, unknown>) {
    this.lines.push({ type, ...data, sessionId: this.o.sessionId });
    return this;
  }
  prompt(text: string) {
    this.lines.push({ ...this.env({ promptSource: this.o.promptSource, permissionMode: 'auto' }), type: 'user', message: { role: 'user', content: text } });
    this.meta('last-prompt', { lastPrompt: text.slice(0, 200), leafUuid: this.parent });
    return this.wait(3);
  }
  private usage(out: number) {
    const ctx = 20_000 + Math.floor(rnd() * 90_000);
    return {
      input_tokens: 3,
      output_tokens: out,
      cache_read_input_tokens: ctx,
      cache_creation_input_tokens: Math.floor(ctx * 0.04),
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: Math.floor(ctx * 0.04) },
      service_tier: 'standard',
    };
  }
  private assistant(blocks: unknown[], stop: string, out: number, model = this.o.model) {
    this.lines.push({
      ...this.env({ requestId: nextId('req'), effort: 'medium' }),
      type: 'assistant',
      message: { model, id: nextId('msg'), type: 'message', role: 'assistant', content: blocks, stop_reason: stop, stop_sequence: null, usage: this.usage(out) },
    });
  }
  say(text: string, final = false) {
    this.assistant([{ type: 'text', text }], final ? 'end_turn' : 'tool_use', 60 + Math.floor(text.length / 3));
    return this.wait(2);
  }
  /** Tool call; `result` undefined = still running. Returns the tool_use id. */
  tool(name: string, input: Record<string, unknown>, result?: Result): string {
    const id = nextId('toolu');
    this.assistant([{ type: 'thinking', thinking: '', signature: 'x' }], 'tool_use', 20);
    this.assistant([{ type: 'tool_use', id, name, input }], 'tool_use', 80 + Math.floor(rnd() * 300));
    if (!result) return id;
    this.wait(result.seconds ?? 1 + rnd() * 3);
    this.lines.push({
      ...this.env({ sourceToolAssistantUUID: this.parent }),
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result.text, is_error: !!result.isError }] },
      toolUseResult: result.structured ?? { stdout: result.text, stderr: '', interrupted: false, isImage: false },
    });
    this.wait(2 + rnd() * 4);
    return id;
  }
  system(subtype: string, data: Record<string, unknown>) {
    this.lines.push({ ...this.env(), type: 'system', subtype, level: 'info', ...data });
    return this;
  }
  save(path: string) {
    write(path, this.lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    // mtime = letzte Aktivität, damit "Letzte Sessions" realistisch sortiert
    const last = new Date(Math.min(this.t, Date.now()));
    utimesSync(path, last, last);
  }
}

const read = (file: string, content: string): Result => ({
  text: content,
  structured: { type: 'text', file: { filePath: file, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length + 40 } },
});
const edit = (file: string, oldStart: number, lines: string[]): Result => ({
  text: `The file ${file} has been updated successfully.`,
  structured: {
    filePath: file,
    oldString: '',
    newString: '',
    originalFile: null,
    structuredPatch: [{ oldStart, oldLines: lines.filter((l) => !l.startsWith('+')).length, newStart: oldStart, newLines: lines.filter((l) => !l.startsWith('-')).length, lines }],
    userModified: false,
    replaceAll: false,
  },
});
const bash = (stdout: string, isError = false, seconds?: number): Result => ({ text: stdout, isError, seconds, structured: { stdout, stderr: '', interrupted: false, isImage: false } });

// ---------------------------------------------------------------------------

/** Writes all demo files below ROOT and returns what the process setup needs. */
function buildScenario() {
  // live scenario: orchestrator (interactive) → subagents + spawned implementer

  const SHOP = '/Users/demo/code/acme-shop';
  const DOCS = '/Users/demo/code/docs-site';
  const shopDir = join(ROOT, 'projects', slug(SHOP));
  const docsDir = join(ROOT, 'projects', slug(DOCS));

  const orchId = uuid();
  const implId = uuid();
  const orch = new Transcript({ sessionId: orchId, cwd: SHOP, start: NOW - 38 * 60_000, model: 'claude-opus-5-5' });
  orch.meta('custom-title', { customTitle: 'orchestrator' }).meta('agent-name', { agentName: 'orchestrator' }).meta('ai-title', { aiTitle: 'Add coupon codes to checkout' });
  orch.prompt('Add coupon codes to the checkout: spec first, then implement it with a separate worker and review the result.');
  orch.say("I'll look at how the checkout computes totals, then write a short spec.");
  orch.tool('Grep', { pattern: 'calculateTotal', path: 'src' }, { text: 'src/checkout/totals.ts\nsrc/checkout/totals.test.ts\nsrc/api/orders.ts', structured: { mode: 'files_with_matches', filenames: ['src/checkout/totals.ts'], numFiles: 3 } });
  orch.tool('Read', { file_path: `${SHOP}/src/checkout/totals.ts` }, read(`${SHOP}/src/checkout/totals.ts`, "import { Cart } from './cart';\n\nexport function calculateTotal(cart: Cart): number {\n  const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);\n  return subtotal + shippingFor(cart);\n}"));
  const exploreStart = orch.t;
  const exploreTool = orch.tool(
    'Agent',
    { subagent_type: 'Explore', description: 'Find discount handling', prompt: 'Find every place where prices, discounts or promotions are applied. Report file:line with a one-line summary each.' },
    { text: 'Discounts are applied in two places:\n- src/checkout/totals.ts:12 – shipping threshold\n- src/api/orders.ts:88 – legacy promo field (unused)', seconds: 95, structured: { status: 'completed', agentId: 'a1f0c2e9d4b7a6c51', totalDurationMs: 95_000, totalTokens: 41_200, totalToolUseCount: 9, resolvedModel: 'claude-sonnet-5' } },
  );
  orch.tool('Write', { file_path: `${SHOP}/docs/specs/0012-coupons.md`, content: '# Spec 0012 – Coupon codes\n\n## Goal\nCustomers can enter one coupon code at checkout.\n\n## Rules\n- percentage or fixed amount\n- never below zero\n- one code per order\n\n## Tests\nT1–T6, see §5' }, { text: 'File created successfully', structured: { type: 'create', filePath: `${SHOP}/docs/specs/0012-coupons.md`, content: '', structuredPatch: [] } });
  orch.tool('TaskCreate', { subject: 'Implement coupon codes (spec 0012)', description: 'Worker implements T1–T6' }, bash('Task #1 created'));
  orch.tool('TaskCreate', { subject: 'Review implementation', description: 'Independent review against the spec' }, bash('Task #2 created'));
  orch.say('Spec is written. Starting a dedicated implementer session for it.');
  const spawnPrompt = 'Implement docs/specs/0012-coupons.md in acme-shop. Write tests T1-T6 first, keep changes inside src/checkout, and summarize in .agent/summary.md.';
  orch.tool('Bash', {
    command: `cd ${SHOP} && claude --agent implementer --model sonnet -p "${spawnPrompt}" --output-format json > .agent/run-1.json`,
    description: 'Start implementer for spec 0012',
    run_in_background: true,
  }, { text: '', structured: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: 'b7k2m9' }, seconds: 1 });
  const implStart = orch.t + 2000;
  const reviewTool = orch.tool(
    'Agent',
    { subagent_type: 'spec-reviewer', description: 'Review spec 0012', prompt: 'Review docs/specs/0012-coupons.md for gaps and contradictions.', run_in_background: true },
    { text: 'Async agent launched successfully.', seconds: 1, structured: { isAsync: true, status: 'async_launched', agentId: 'b82d4e1f09c3a7d65', description: 'Review spec 0012', resolvedModel: 'claude-opus-5-5' } },
  );
  orch.tool('Bash', { command: 'npm run lint -- src/checkout', description: 'Lint checkout module' }, bash('✔ 0 problems', false, 6));
  orch.say('Implementer and spec review are running. I will check back when the worker reports.');
  orch.t = NOW - 75_000;
  orch.tool('Bash', { command: 'sleep 240; cat .agent/status.json', description: 'Wait for implementer status' });
  orch.save(join(shopDir, `${orchId}.jsonl`));

  // subagent 1 (done)
  const sub1 = new Transcript({ sessionId: orchId, cwd: SHOP, start: exploreStart + 6000, model: 'claude-sonnet-5', agentId: 'a1f0c2e9d4b7a6c51' });
  sub1.prompt('Find every place where prices, discounts or promotions are applied. Report file:line with a one-line summary each.');
  for (const f of ['totals.ts', 'cart.ts', 'orders.ts', 'promo.ts']) sub1.tool('Grep', { pattern: 'discount|promo', path: `src/${f}` }, bash(`src/${f}:12`, false, 6 + rnd() * 8));
  sub1.wait(10).tool('Read', { file_path: `${SHOP}/src/api/orders.ts` }, read(`${SHOP}/src/api/orders.ts`, '// legacy promo field\nconst promo = body.promo ?? null;'));
  sub1.say('Discounts are applied in two places …', true);
  sub1.save(join(shopDir, orchId, 'subagents', 'agent-a1f0c2e9d4b7a6c51.jsonl'));
  write(join(shopDir, orchId, 'subagents', 'agent-a1f0c2e9d4b7a6c51.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find discount handling', toolUseId: exploreTool, spawnDepth: 1, requestShape: 'foreground' }));

  // subagent 2 (background, running)
  const sub2 = new Transcript({ sessionId: orchId, cwd: SHOP, start: implStart + 3000, model: 'claude-opus-5-5', agentId: 'b82d4e1f09c3a7d65' });
  sub2.prompt('Review docs/specs/0012-coupons.md for gaps and contradictions.');
  sub2.tool('Read', { file_path: `${SHOP}/docs/specs/0012-coupons.md` }, read(`${SHOP}/docs/specs/0012-coupons.md`, '# Spec 0012 – Coupon codes'));
  sub2.tool('Grep', { pattern: 'currency', path: 'src/checkout' }, bash('src/checkout/money.ts:3'));
  sub2.t = NOW - 25_000;
  sub2.tool('Read', { file_path: `${SHOP}/src/checkout/money.ts` });
  sub2.save(join(shopDir, orchId, 'subagents', 'agent-b82d4e1f09c3a7d65.jsonl'));
  write(join(shopDir, orchId, 'subagents', 'agent-b82d4e1f09c3a7d65.meta.json'), JSON.stringify({ agentType: 'spec-reviewer', description: 'Review spec 0012', toolUseId: reviewTool, spawnDepth: 1, requestShape: 'background' }));

  // spawned implementer session (own process, started via `claude -p`)
  const impl = new Transcript({ sessionId: implId, cwd: SHOP, start: implStart, model: 'claude-sonnet-5', entrypoint: 'sdk-cli', promptSource: 'sdk' });
  impl.meta('agent-setting', { agentSetting: 'implementer' }).meta('ai-title', { aiTitle: 'Implement coupon codes (spec 0012)' });
  impl.lines.push({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(implStart).toISOString(), sessionId: implId, content: spawnPrompt });
  impl.prompt(spawnPrompt);
  impl.tool('Read', { file_path: `${SHOP}/docs/specs/0012-coupons.md` }, read(`${SHOP}/docs/specs/0012-coupons.md`, '# Spec 0012 – Coupon codes'));
  impl.tool('Write', { file_path: `${SHOP}/src/checkout/coupon.test.ts`, content: "describe('coupons', () => {\n  it('T1 applies percentage', () => {});\n  it('T2 applies fixed amount', () => {});\n});" }, { text: 'File created successfully', structured: { type: 'create', filePath: `${SHOP}/src/checkout/coupon.test.ts`, content: '', structuredPatch: [] } });
  impl.tool('Bash', { command: 'npm test -- coupon', description: 'Run coupon tests (expect red)' }, bash('FAIL src/checkout/coupon.test.ts\n  ✕ T1 applies percentage\n  ✕ T2 applies fixed amount', true, 14));
  impl.tool(
    'Edit',
    { file_path: `${SHOP}/src/checkout/totals.ts`, old_string: '  return subtotal + shippingFor(cart);', new_string: '  const discount = applyCoupon(subtotal, cart.coupon);\n  return Math.max(0, subtotal - discount) + shippingFor(cart);' },
    edit(`${SHOP}/src/checkout/totals.ts`, 3, [
      ' export function calculateTotal(cart: Cart): number {',
      '   const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);',
      '-  return subtotal + shippingFor(cart);',
      '+  const discount = applyCoupon(subtotal, cart.coupon);',
      '+  return Math.max(0, subtotal - discount) + shippingFor(cart);',
      ' }',
    ]),
  );
  impl.tool('Write', { file_path: `${SHOP}/src/checkout/coupon.ts`, content: 'export function applyCoupon(subtotal: number, code?: Coupon): number {\n  if (!code) return 0;\n  return code.kind === "percent" ? subtotal * code.value / 100 : code.value;\n}' }, { text: 'File created successfully', structured: { type: 'create', filePath: `${SHOP}/src/checkout/coupon.ts`, content: '', structuredPatch: [] } });
  impl.tool('Bash', { command: 'npm test -- coupon', description: 'Run coupon tests' }, bash('PASS src/checkout/coupon.test.ts\n  ✓ T1 applies percentage (3 ms)\n  ✓ T2 applies fixed amount (1 ms)', false, 12));
  impl.t = NOW - 70_000;
  impl.tool('Bash', { command: 'npm test', description: 'Run full test suite' });
  impl.save(join(shopDir, `${implId}.jsonl`));

  // docs-site session (interactive, idle)
  const docsId = uuid();
  const docs = new Transcript({ sessionId: docsId, cwd: DOCS, start: NOW - 55 * 60_000, model: 'claude-sonnet-5' });
  docs.meta('ai-title', { aiTitle: 'Fix broken links in the docs' });
  docs.prompt('Find and fix broken internal links in the docs.');
  docs.tool('Bash', { command: 'npx linkinator ./build --recurse', description: 'Check links' }, bash('✖ 3 broken links\n  /guide/install → 404\n  /api/v1 → 404\n  /faq#billing → 404', true, 22));
  docs.tool('Grep', { pattern: '/guide/install', path: 'content' }, bash('content/index.md:14\ncontent/start.md:3'));
  for (const f of ['index.md', 'start.md']) {
    docs.tool('Edit', { file_path: `${DOCS}/content/${f}`, old_string: '/guide/install', new_string: '/guide/installation' }, edit(`${DOCS}/content/${f}`, 14, ['-See the [install guide](/guide/install).', '+See the [install guide](/guide/installation).']));
  }
  docs.tool('Bash', { command: 'npx linkinator ./build --recurse', description: 'Re-check links' }, bash('✔ 0 broken links', false, 20));
  docs.say('All internal links resolve again. I fixed 3 links in 2 files.', true);
  docs.t = NOW - 31 * 60_000;
  docs.save(join(docsDir, `${docsId}.jsonl`));

  // ---------------------------------------------------------------------------
  // history: two weeks of finished sessions for statistics

  const PROJECTS = [SHOP, DOCS, '/Users/demo/code/billing-service', '/Users/demo/code/mobile-app'];
  const MODELS = ['claude-sonnet-5', 'claude-sonnet-5', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-haiku-4-5'];
  const TOPICS = ['Refactor pricing module', 'Add retry to webhook sender', 'Upgrade to Node 22', 'Fix flaky login test', 'Write migration for orders table', 'Improve search ranking', 'Add dark mode toggle', 'Document the public API', 'Investigate memory leak', 'Split monolith config'];
  const FILES = ['src/index.ts', 'src/api/routes.ts', 'src/db/schema.ts', 'README.md', 'src/ui/Button.tsx', 'package.json', 'src/jobs/webhook.ts', 'tests/e2e/login.spec.ts'];
  for (let d = 14; d >= 1; d--) {
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const cwd = pick(PROJECTS);
      const sid = uuid();
      const start = NOW - d * 86_400_000 + (8 + Math.floor(rnd() * 11)) * 3_600_000 + Math.floor(rnd() * 3_600_000);
      const tr = new Transcript({ sessionId: sid, cwd, start, model: pick(MODELS) });
      const topic = pick(TOPICS);
      tr.meta('ai-title', { aiTitle: topic });
      tr.prompt(`${topic}.`);
      const calls = 8 + Math.floor(rnd() * 40);
      for (let c = 0; c < calls; c++) {
        const f = `${cwd}/${pick(FILES)}`;
        const r = rnd();
        if (r < 0.4) tr.tool('Bash', { command: pick(['npm test', 'npm run build', 'git status', 'git diff --stat', 'npm run lint']), description: pick(['Run tests', 'Build', 'Check status', 'Show diff', 'Lint']) }, bash('ok', rnd() < 0.06, 2 + rnd() * 30));
        else if (r < 0.65) tr.tool('Read', { file_path: f }, read(f, '// …'));
        else if (r < 0.85) tr.tool('Edit', { file_path: f, old_string: 'a', new_string: 'b' }, edit(f, 10, ['-a', '+b']));
        else if (r < 0.95) tr.tool('Grep', { pattern: pick(['TODO', 'retry', 'price', 'auth']) }, bash('3 matches'));
        else tr.tool('Write', { file_path: f, content: '…' }, { text: 'File created successfully', structured: { type: 'create', filePath: f, content: '', structuredPatch: [] } });
      }
      tr.say(`Done: ${topic.toLowerCase()}.`, true);
      tr.save(join(ROOT, 'projects', slug(cwd), `${sid}.jsonl`));
    }
  }

  // tasks of the orchestrator
  write(join(ROOT, 'tasks', orchId, '1.json'), JSON.stringify({ id: '1', subject: 'Implement coupon codes (spec 0012)', description: 'Worker implements T1–T6', activeForm: 'Implementing coupon codes', status: 'in_progress', blocks: ['2'], blockedBy: [] }));
  write(join(ROOT, 'tasks', orchId, '2.json'), JSON.stringify({ id: '2', subject: 'Review implementation', description: 'Independent review against the spec', status: 'pending', blocks: [], blockedBy: ['1'] }));
  write(join(ROOT, 'tasks', orchId, '3.json'), JSON.stringify({ id: '3', subject: 'Write spec 0012', status: 'completed', blocks: [], blockedBy: [] }));

  // prompt history
  write(join(ROOT, 'history.jsonl'), [orch, docs].map((t) => JSON.stringify({ display: (t.lines.find((l: any) => l.type === 'user') as any).message.content, timestamp: t.o.start, project: t.o.cwd, sessionId: t.o.sessionId, pastedContents: {} })).join('\n') + '\n');

  return { orch, docs, orchId, implId, docsId, implStart, SHOP, DOCS };
}

// ---------------------------------------------------------------------------
// processes: real (sleeping) processes so the liveness check sees them running

function procStart(pid: number): string {
  return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).toString().trim();
}
function sessionFile(pid: number, data: Record<string, unknown>) {
  write(join(ROOT, 'sessions', `${pid}.json`), JSON.stringify({ pid, procStart: procStart(pid), version: VERSION, peerProtocol: 1, pidDomain: process.platform, updatedAt: NOW, statusUpdatedAt: NOW - 20_000, ...data }));
}

export interface DemoOptions {
  /** only generate into this directory – no processes, no server */
  out?: string;
  port: number;
  open: boolean;
}

export async function runDemo(opts: DemoOptions): Promise<void> {
  ROOT = opts.out ?? join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'claude-inspect-demo');
  if (!opts.out) rmSync(ROOT, { recursive: true, force: true }); // always fresh demo data
  const s = buildScenario();
  if (opts.out) {
    console.log(`Demo data written to ${ROOT} (no processes started)`);
    return;
  }
  if (process.platform === 'win32') {
    console.error('The live demo starts Unix processes (sh, sleep, pgrep) and needs macOS or Linux. Use `demo --out <dir>` to only generate the data.');
    process.exit(1);
  }

  // orchestrator = shell that forks the implementer (process tree: implementer → orchestrator)
  const children: ChildProcess[] = [
    spawn('sh', ['-c', 'sleep 7200 & wait'], { stdio: 'ignore', detached: true }),
    spawn('sleep', ['7200'], { stdio: 'ignore', detached: true }),
  ];
  const [orchProc, docsProc] = children;
  process.on('exit', () => {
    for (const c of children) {
      try {
        process.kill(-c.pid!); // whole process group, including the child sleep
      } catch {
        c.kill();
      }
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  const implPid = Number(execFileSync('pgrep', ['-P', String(orchProc.pid)]).toString().trim().split('\n')[0]);
  sessionFile(orchProc.pid!, { sessionId: s.orchId, cwd: s.SHOP, startedAt: s.orch.o.start, kind: 'interactive', entrypoint: 'cli', name: 'orchestrator', nameSource: 'user', status: 'busy', bridgeSessionId: 'session_demo' });
  sessionFile(implPid, { sessionId: s.implId, cwd: s.SHOP, startedAt: s.implStart, kind: 'interactive', entrypoint: 'sdk-cli', name: 'acme-shop-impl', nameSource: 'derived', status: 'busy', agent: 'implementer' });
  sessionFile(docsProc.pid!, { sessionId: s.docsId, cwd: s.DOCS, startedAt: s.docs.o.start, kind: 'interactive', entrypoint: 'cli', name: 'docs', nameSource: 'user', status: 'idle' });

  console.log(`Demo data in ${ROOT}`);
  // config.ts reads CLAUDE_CONFIG_DIR on import – set it before loading the server
  process.env.CLAUDE_CONFIG_DIR = ROOT;
  const { runServer } = await import('../run.js');
  await runServer({ port: opts.port, open: opts.open, token: process.env.CLAUDE_INSPECT_TOKEN ?? 'demo' });
}
