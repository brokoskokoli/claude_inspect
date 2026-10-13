/**
 * Calibrates the plan budgets in src/shared/budget.ts from real data.
 *
 * Reads the transcripts of one or more Claude Code directories (e.g. this machine and a copy of a
 * server's ~/.claude – all machines that use the same account), sums the API list-price equivalent of
 * every model response and compares it with the `/usage` readings stored in the transcripts
 * (percent of the weekly and of the 5-hour limit). Result: dollars per 1 % of each limit.
 *
 *   npm run calibrate -- ~/.claude ~/claude-server/.claude
 *
 * A drop of the weekly percentage before its reset time (plan change) starts a new segment.
 * Run `/usage` now and then on each machine – more readings, better numbers.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { addUsage, emptyTotals, estimateCost } from '../src/shared/pricing.js';
import type { Usage } from '../src/shared/types.js';

interface Reading {
  t: number;
  kind: string;
  percent: number;
  resetsAt: number;
}

const HOUR = 3_600_000;
const dirs = process.argv.slice(2).map((d) => d.replace(/^~(?=\/|$)/, homedir()));
if (!dirs.length) dirs.push(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));

async function* jsonlFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const responses = new Map<string, { t: number; usd: number }>(); // message id → last record wins
const readings: Reading[] = [];
const unpriced = new Map<string, number>();

for (const dir of dirs) {
  let files = 0;
  for await (const f of jsonlFiles(join(dir, 'projects'))) {
    files++;
    for (const line of (await readFile(f, 'utf8')).split('\n')) {
      if (!line.includes('"usage"') && !line.includes('"rate_limits"')) continue;
      let r: Record<string, any>;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      const t = Date.parse(r.timestamp);
      if (Number.isNaN(t)) continue;
      for (const l of r.usageReport?.rate_limits?.limits ?? []) {
        if (typeof l.percent === 'number' && l.resets_at && !l.scope) readings.push({ t, kind: l.kind, percent: l.percent, resetsAt: Date.parse(l.resets_at) });
      }
      const m = r.message;
      if (r.type !== 'assistant' || !m?.usage || !m.id || !m.model || m.model === '<synthetic>') continue;
      const one = emptyTotals();
      addUsage(one, m.usage as Usage);
      const usd = estimateCost(m.model, one);
      if (usd === undefined) unpriced.set(m.model, (unpriced.get(m.model) ?? 0) + 1);
      else responses.set(m.id, { t, usd });
    }
  }
  console.log(`${dir}: ${files} transcripts`);
}

const recs = [...responses.values()].sort((a, b) => a.t - b.t);
const times = recs.map((r) => r.t);
const cum = [0];
for (const r of recs) cum.push(cum[cum.length - 1] + r.usd);
const idx = (t: number, right: boolean) => {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (right ? times[mid] <= t : times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
const spent = (a: number, b: number) => cum[idx(b, true)] - cum[idx(a, false)];
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const day = (t: number) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

console.log(`${recs.length} model responses, $${cum[cum.length - 1].toFixed(0)} API equivalent, ${readings.length} /usage readings`);
if (unpriced.size) console.log('no price for:', Object.fromEntries(unpriced));

/**
 * Segments: one per reset window; a drop of the percentage within a window (plan change) starts a
 * new segment whose baseline is the reading after the drop.
 */
function calibrate(kind: string, windowMs: number, minPercent: number) {
  const byReset = new Map<number, Reading[]>();
  for (const r of readings.filter((x) => x.kind === kind)) {
    const key = Math.round(r.resetsAt / HOUR) * HOUR;
    byReset.set(key, [...(byReset.get(key) ?? []), r]);
  }
  const segments: { from: number; to: number; ratios: number[] }[] = [];
  for (const [reset, rs] of [...byReset.entries()].sort((a, b) => a[0] - b[0])) {
    rs.sort((a, b) => a.t - b.t);
    let base = { t: reset - windowMs, percent: 0 };
    let seg = { from: base.t, to: base.t, ratios: [] as number[] };
    let last = -1;
    for (const r of rs) {
      if (r.t < reset - windowMs) continue;
      if (r.percent < last - 5) {
        if (seg.ratios.length) segments.push(seg);
        base = { t: r.t, percent: r.percent };
        seg = { from: r.t, to: r.t, ratios: [] };
      }
      last = r.percent;
      seg.to = r.t;
      const p = r.percent - base.percent;
      if (p >= minPercent) seg.ratios.push(spent(base.t, r.t) / p);
    }
    if (seg.ratios.length) segments.push(seg);
  }
  return segments;
}

const weekly = calibrate('weekly_all', 7 * 24 * HOUR, 10);
const sessions = calibrate('session', 5 * HOUR, 15);

console.log('\nAPI equivalent of 100 % (median), per period between plan changes / weekly resets:');
weekly.forEach((w, i) => {
  const end = weekly[i + 1]?.from ?? Infinity;
  const s = sessions.filter((x) => x.from >= w.from && x.from < end).flatMap((x) => x.ratios);
  const wm = median(w.ratios);
  const sm = median(s);
  console.log(
    `  ${day(w.from)} – ${day(w.to)}:  week $${(wm * 100).toFixed(0)} (${w.ratios.length} readings)` +
      (s.length ? `  ·  5-hour window $${(sm * 100).toFixed(0)} (${s.length} readings)` : ''),
  );
});
