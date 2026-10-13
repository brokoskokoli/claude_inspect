<script lang="ts">
  import type { CostRow, SessionCost } from '$shared/types';
  import { modelColor } from '../lib/colors';
  import { modelName, tokens, usd } from '../lib/format';
  import { href } from '../lib/router.svelte';
  import StatusDot from './StatusDot.svelte';

  let { cost }: { cost: SessionCost } = $props();

  const cacheWrite = (r: { tokens: { cacheWrite5m: number; cacheWrite1h: number } }) => r.tokens.cacheWrite5m + r.tokens.cacheWrite1h;
  const maxCost = $derived(Math.max(0, ...cost.rows.map((r) => r.costUSD)));
  const agents = $derived(cost.rows.filter((r) => r.kind === 'subagent').length);
  const spawns = $derived(cost.rows.filter((r) => r.kind === 'spawn').length);
  const mainShare = $derived(cost.costUSD ? (cost.rows[0]?.costUSD ?? 0) / cost.costUSD : 0);

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
  <div class="card tile">
    <div class="label">Delegated</div>
    <div class="value">{((1 - mainShare) * 100).toFixed(0)} %</div>
    <div class="sub faint">of the cost spent by subagents and spawned sessions</div>
  </div>
</section>

<p class="faint small note">
  Estimated at API list prices from the token usage in the transcripts; on a subscription these amounts are not billed directly.
  {#if cost.reportedCostUSD !== undefined}Claude Code itself reported {usd(cost.reportedCostUSD)} for the main agent.{/if}
  {#if cost.unpricedModels.length}<span class="badge">no price for {cost.unpricedModels.map(modelName).join(', ')} – not included</span>{/if}
  {#if !cost.ready}<span class="badge">history scan still running – numbers may be incomplete</span>{/if}
</p>

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
