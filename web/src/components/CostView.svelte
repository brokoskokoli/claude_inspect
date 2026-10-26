<script lang="ts">
  import type { CostRow, SessionCost } from '$shared/types';
  import { modelColor } from '../lib/colors';
  import { modelName, tokens, usd } from '../lib/format';
  import { href } from '../lib/router.svelte';
  import StatusDot from './StatusDot.svelte';
  import StackedColumns from './charts/StackedColumns.svelte';
  import BudgetSettings from './BudgetSettings.svelte';
  import { activePlan, pct } from '../lib/budget.svelte';
  import CostWindowView from './CostWindowView.svelte';

  let { cost, sessionId, agent }: { cost: SessionCost; sessionId: string; agent?: string } = $props();

  /**
   * Ausgewähltes Zeitfenster (Klick oder Ziehen über Spalten) → Details darunter. Gespeichert als
   * Zeitspanne, nicht als Spaltennummern: Beim Nachladen einer laufenden Session entstehen neue
   * Spalten-Objekte (und evtl. eine andere Spaltenbreite), die Auswahl bleibt trotzdem dieselbe.
   */
  let win = $state<{ from: number; to: number } | null>(null);
  const sel = $derived.by((): [number, number] | null => {
    if (!win) return null;
    const { buckets, bucketMs } = cost.timeline;
    const a = buckets.findIndex((b) => b.start + bucketMs > win!.from);
    const b = buckets.findLastIndex((x) => x.start < win!.to);
    return a >= 0 && b >= a ? [a, b] : null;
  });
  let detailsEl = $state<HTMLElement>();
  function select(a: number, b: number) {
    const { buckets, bucketMs } = cost.timeline;
    const next = { from: buckets[a].start, to: buckets[b].start + bucketMs };
    win = win && win.from === next.from && win.to === next.to ? null : next;
    if (win) requestAnimationFrame(() => detailsEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  const cacheWrite = (r: { tokens: { cacheWrite5m: number; cacheWrite1h: number } }) => r.tokens.cacheWrite5m + r.tokens.cacheWrite1h;
  const maxCost = $derived(Math.max(0, ...cost.rows.map((r) => r.costUSD)));
  const agents = $derived(cost.rows.filter((r) => r.kind === 'subagent').length);
  const spawns = $derived(cost.rows.filter((r) => r.kind === 'spawn').length);
  const mainShare = $derived(cost.costUSD ? (cost.rows[0]?.costUSD ?? 0) / cost.costUSD : 0);

  // --- Zeitleiste
  const KIND_KEYS = ['main', 'subagent', 'spawn'];
  const KIND_LABEL: Record<string, string> = { main: 'Main agent', subagent: 'Subagents', spawn: 'Spawned sessions' };
  const KIND_COLOR: Record<string, string> = { main: 'var(--series-1)', subagent: 'var(--series-3)', spawn: 'var(--series-7)' };
  let stackBy = $state<'kind' | 'model'>('kind');
  let unit = $state<'usd' | 'week'>('usd');
  const plan = $derived(activePlan());
  const asWeek = $derived(unit === 'week' && !!plan);
  const tl = $derived(cost.timeline);
  const modelKeys = $derived(cost.byModel.map((m) => m.model));
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  const hm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const multiDay = $derived(tl.buckets.length > 0 && day(tl.buckets[0].start) !== day(tl.buckets[tl.buckets.length - 1].start));
  function tick(ms: number): string {
    if (tl.bucketMs >= 86_400_000) return day(ms);
    return multiDay && (hm(ms) === '00:00' || ms === tl.buckets[0]?.start) ? `${day(ms)} ${hm(ms)}` : hm(ms);
  }
  function range(ms: number): string {
    const end = ms + tl.bucketMs;
    if (tl.bucketMs >= 86_400_000) return tl.bucketMs === 86_400_000 ? day(ms) : `${day(ms)} – ${day(end)}`;
    return `${multiDay ? day(ms) + ' ' : ''}${hm(ms)}–${hm(end)}`;
  }
  const columns = $derived(
    tl.buckets.map((b) => ({
      label: tick(b.start),
      title: range(b.start),
      segments: Object.entries(stackBy === 'kind' ? b.byKind : b.byModel).map(([key, value]) => ({
        key,
        value: asWeek && plan ? ((value ?? 0) / plan.weekUSD) * 100 : (value ?? 0),
      })),
    })),
  );
  const bucketLabel = $derived.by(() => {
    const m = tl.bucketMs / 60_000;
    return m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} d`;
  });
  const peaks = $derived(
    [...tl.buckets]
      .filter((b) => b.costUSD > 0)
      .sort((a, b) => b.costUSD - a.costUSD)
      .slice(0, 5),
  );
  const rowById = $derived(new Map(cost.rows.map((r) => [r.id, r])));
  const fmtUsd = (v: number) => (v >= 100 || Number.isInteger(v) ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);
  const fmtPct = (v: number) => `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(v < 1 ? 2 : 1)} %`;

  function rowHref(r: CostRow): string {
    return r.kind === 'subagent' ? href.session(r.sessionId, r.agentId) : href.session(r.sessionId);
  }
</script>

<section class="tiles">
  <div class="card tile">
    <div class="label">API equivalent (estimate)</div>
    <div class="value">{usd(cost.costUSD)}</div>
    <div class="sub faint">main agent, {agents} subagent{agents === 1 ? '' : 's'}{spawns ? `, ${spawns} spawned session${spawns === 1 ? '' : 's'}` : ''}</div>
  </div>
  <div class="card tile">
    <div class="label">Output tokens</div>
    <div class="value">{tokens(cost.total.output)}</div>
    <div class="sub faint">{cost.total.requests.toLocaleString('en-US')} model requests</div>
  </div>
  <div class="card tile">
    <div class="label">Input tokens</div>
    <div class="value">{tokens(cost.total.input + cost.total.cacheRead + cost.total.cacheWrite5m + cost.total.cacheWrite1h)}</div>
    <div class="sub faint">{tokens(cost.total.cacheRead)} read from cache · {tokens(cost.total.cacheWrite5m + cost.total.cacheWrite1h)} written</div>
  </div>
  {#if plan}
    <div class="card tile">
      <div class="label">Share of {plan.label} budget (estimate)</div>
      <div class="value">≈ {pct(cost.costUSD, plan.weekUSD)} <span class="unit">of a week</span></div>
      <div class="sub faint">≈ {pct(cost.costUSD, plan.sessionUSD)} of a 5-hour window</div>
    </div>
  {/if}
  <div class="card tile">
    <div class="label">Delegated</div>
    <div class="value">{((1 - mainShare) * 100).toFixed(0)} %</div>
    <div class="sub faint">of the cost spent by subagents and spawned sessions</div>
  </div>
</section>

<div class="faint small note">
  Estimated at API list prices from the token usage in the transcripts; on a subscription these amounts are not billed directly.
  {#if cost.reportedCostUSD !== undefined}Claude Code itself reported {usd(cost.reportedCostUSD)} for the main agent.{/if}
  {#if cost.unpricedModels.length}<span class="badge">no price for {cost.unpricedModels.map(modelName).join(', ')} – not included</span>{/if}
  <BudgetSettings />
</div>

{#if tl.buckets.length > 1}
  <section class="card block">
    <div class="block-head">
      <h3>Over time <span class="faint small">per {bucketLabel}</span></h3>
      <div class="controls">
      {#if plan}
        <div class="seg">
          <button class:on={unit === 'usd'} onclick={() => (unit = 'usd')}>$</button>
          <button class:on={unit === 'week'} onclick={() => (unit = 'week')}>% of week</button>
        </div>
      {/if}
      <div class="seg">
        <button class:on={stackBy === 'kind'} onclick={() => (stackBy = 'kind')}>By agent type</button>
        <button class:on={stackBy === 'model'} onclick={() => (stackBy = 'model')}>By model</button>
      </div>
      </div>
    </div>
    <div class="legend">
      {#if stackBy === 'kind'}
        {#each KIND_KEYS.filter((k) => cost.rows.some((r) => r.kind === k)) as k (k)}<span><span class="swatch" style:background={KIND_COLOR[k]}></span>{KIND_LABEL[k]}</span>{/each}
      {:else}
        {#each modelKeys as m (m)}<span><span class="swatch" style:background={modelColor(m)}></span>{modelName(m)}</span>{/each}
      {/if}
    </div>
    {#key `${stackBy}|${asWeek}`}
      <StackedColumns
        {columns}
        keys={stackBy === 'kind' ? KIND_KEYS : modelKeys}
        colorOf={(k) => (stackBy === 'kind' ? KIND_COLOR[k] : modelColor(k))}
        labelOf={(k) => (stackBy === 'kind' ? KIND_LABEL[k] : modelName(k))}
        format={asWeek ? fmtPct : fmtUsd}
        ariaLabel={asWeek ? `Share of the ${plan?.label} weekly budget over time` : 'Estimated cost over time'}
        selected={sel}
        onselect={select}
      />
    {/key}
    {#if win}
      <div bind:this={detailsEl}>
        <CostWindowView {sessionId} {agent} from={win.from} to={win.to} label={win.to - win.from <= cost.timeline.bucketMs ? range(win.from) : `${range(win.from).split('–')[0]}–${range(win.to - cost.timeline.bucketMs).split('–')[1]}`} onclose={() => (win = null)} />
      </div>
    {:else}
      <p class="faint small">Click a column to see what cost money in that time, or drag across several.</p>
    {/if}

    {#if peaks.length}
      <h4>Most expensive moments</h4>
      <ol class="peaks">
        {#each peaks as b (b.start)}
          <li>
            <button class="when linkish" title="Show what cost money in this time" onclick={() => { const i = tl.buckets.indexOf(b); select(i, i); }}>{range(b.start)}</button>
            <span class="strong">{usd(b.costUSD)}</span>
            {#if plan}<span class="muted">≈ {pct(b.costUSD, plan.weekUSD)} of week · {pct(b.costUSD, plan.sessionUSD)} of 5 h</span>{/if}
            <span class="faint small">{b.requests} requests · {tokens(b.outputTokens)} output</span>
            <span class="who">
              {#each b.top as t (t.id)}
                {@const r = rowById.get(t.id)}
                <span class="who-item">
                  {#if r}<a href={rowHref(r)} title={t.sublabel}>{t.label}</a>{:else}{t.label}{/if}
                  {#if t.sublabel && r?.kind !== 'main'}<span class="faint who-sub">{t.sublabel}</span>{/if}
                  <span class="faint">{usd(t.costUSD)}</span>
                </span>
              {/each}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
{/if}

<section class="card block">
  <h3>By agent</h3>
  <div class="scroll">
    <table class="list">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Model</th>
          <th class="num">Requests</th>
          <th class="num">Input</th>
          <th class="num">Output</th>
          <th class="num">Cache read</th>
          <th class="num">Cache write</th>
          <th class="num">Cost</th>
          <th class="bar-col"></th>
        </tr>
      </thead>
      <tbody>
        {#each cost.rows as r (r.id)}
          <tr>
            <td>
              <div class="agent" style:padding-left="{r.depth * 16}px">
                <StatusDot state={r.status ?? 'done'} size={8} />
                <a href={rowHref(r)}>{r.label}</a>
                {#if r.kind === 'spawn'}<span class="badge">spawned</span>{/if}
              </div>
              {#if r.sublabel}<div class="faint small sub" style:padding-left="{r.depth * 16 + 14}px">{r.sublabel}</div>{/if}
            </td>
            <td class="models">
              {#each r.byModel as m (m.model)}<span><span class="swatch" style:background={modelColor(m.model)}></span>{modelName(m.model)}</span>{/each}
            </td>
            <td class="num">{r.tokens.requests.toLocaleString('en-US')}</td>
            <td class="num">{tokens(r.tokens.input)}</td>
            <td class="num">{tokens(r.tokens.output)}</td>
            <td class="num">{tokens(r.tokens.cacheRead)}</td>
            <td class="num">{tokens(cacheWrite(r))}</td>
            <td class="num strong">{usd(r.costUSD)}</td>
            <td class="bar-col"><div class="bar" style:width="{maxCost ? (r.costUSD / maxCost) * 100 : 0}%"></div></td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td></td>
          <td class="num">{cost.total.requests.toLocaleString('en-US')}</td>
          <td class="num">{tokens(cost.total.input)}</td>
          <td class="num">{tokens(cost.total.output)}</td>
          <td class="num">{tokens(cost.total.cacheRead)}</td>
          <td class="num">{tokens(cost.total.cacheWrite5m + cost.total.cacheWrite1h)}</td>
          <td class="num strong">{usd(cost.costUSD)}</td>
          <td class="bar-col"></td>
        </tr>
      </tfoot>
    </table>
  </div>
</section>

<section class="card block">
  <h3>By model</h3>
  <div class="scroll">
    <table class="list">
      <thead><tr><th>Model</th><th class="num">Requests</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache read</th><th class="num">Cache write</th><th class="num">Cost</th></tr></thead>
      <tbody>
        {#each cost.byModel as m (m.model)}
          <tr>
            <td><span class="swatch" style:background={modelColor(m.model)}></span> {modelName(m.model)}</td>
            <td class="num">{m.tokens.requests.toLocaleString('en-US')}</td>
            <td class="num">{tokens(m.tokens.input)}</td>
            <td class="num">{tokens(m.tokens.output)}</td>
            <td class="num">{tokens(m.tokens.cacheRead)}</td>
            <td class="num">{tokens(m.tokens.cacheWrite5m + m.tokens.cacheWrite1h)}</td>
            <td class="num">{m.costUSD === undefined ? 'unknown' : usd(m.costUSD)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
    gap: 12px;
    margin-bottom: 10px;
  }
  .tile {
    padding: 12px 16px;
  }
  .label {
    font-size: 12px;
    color: var(--muted);
  }
  .value {
    font-size: 22px;
    font-weight: 600;
    margin: 2px 0;
  }
  .sub,
  .small {
    font-size: 12px;
  }
  .note {
    margin: 0 0 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
  }
  .block {
    padding: 14px 16px;
    margin-bottom: 16px;
    min-width: 0;
  }
  h3 {
    font-size: 14px;
    margin: 0 0 10px;
  }
  .scroll {
    overflow-x: auto;
  }
  .agent {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  div.sub {
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .models {
    white-space: nowrap;
  }
  .models span + span {
    margin-left: 8px;
  }
  .swatch {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    margin-right: 4px;
  }
  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 6px;
  }
  .controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .unit {
    font-size: 13px;
    font-weight: 400;
    color: var(--muted);
  }
  .block-head h3 {
    margin: 0;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 8px;
  }
  h4 {
    font-size: 13px;
    margin: 16px 0 6px;
  }
  .peaks {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .peaks li {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    align-items: baseline;
  }
  .when {
    font-variant-numeric: tabular-nums;
    min-width: 120px;
  }
  .linkish {
    border: none;
    background: none;
    padding: 0;
    text-align: left;
    color: var(--link, var(--accent));
    cursor: pointer;
    font: inherit;
  }
  .linkish:hover {
    text-decoration: underline;
  }
  .who {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    flex-basis: 100%;
  }
  .who-item {
    display: inline-flex;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
  }
  .who-sub {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .strong {
    font-weight: 600;
  }
  tfoot td {
    border-top: 1px solid var(--border);
    font-weight: 600;
  }
  .bar-col {
    width: 90px;
    min-width: 60px;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--accent);
    opacity: 0.75;
  }
</style>
