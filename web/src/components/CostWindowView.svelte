<script lang="ts">
  import type { CostSplit, CostWindow } from '$shared/types';
  import { splitMcpName } from '$shared/tools';
  import { api } from '../lib/api';
  import { modelName, time, tokens, usd } from '../lib/format';
  import { href } from '../lib/router.svelte';
  import Spinner from './Spinner.svelte';

  /** Was in einem Zeitfenster der Kosten-Zeitleiste Geld gekostet hat (Klick auf eine Spalte). */
  let { sessionId, agent, from, to, label, onclose }: { sessionId: string; agent?: string; from: number; to: number; label: string; onclose: () => void } = $props();

  let w = $state<CostWindow | null>(null);
  let error = $state('');
  let showAll = $state(false);
  let showAllAgents = $state(false);
  $effect(() => {
    const [f, t] = [from, to];
    w = null;
    error = '';
    showAll = false;
    showAllAgents = false;
    api.costWindow(sessionId, agent, f, t).then(
      (r) => {
        if (from === f && to === t) w = r;
      },
      (e) => (error = String(e)),
    );
  });

  const PARTS: { key: keyof CostSplit; label: string; hint: string; color: string }[] = [
    { key: 'context', label: 'Re-reading context', hint: 'Every request reads the whole conversation so far again (from the cache).', color: 'var(--series-1)' },
    { key: 'added', label: 'New context', hint: 'What came in since the previous request – mostly tool results such as file contents or command output.', color: 'var(--series-4)' },
    { key: 'output', label: 'Answers', hint: "The model's own output: text, thinking and tool calls.", color: 'var(--series-3)' },
  ];
  const share = (s: CostSplit, k: keyof CostSplit) => {
    const sum = s.context + s.added + s.output;
    return sum ? (s[k] / sum) * 100 : 0;
  };
  const pctText = (v: number) => `${v < 1 && v > 0 ? '<1' : Math.round(v)} %`;

  const lanes = $derived(new Map(w?.byAgent.map((a) => [a.id, a]) ?? []));
  const maxAction = $derived(Math.max(0, ...(w?.byAction.map((a) => a.costUSD) ?? [])));
  const maxAgent = $derived(Math.max(0, ...(w?.byAgent.map((a) => a.costUSD) ?? [])));
  const items = $derived(w ? (showAll ? w.items : w.items.slice(0, 25)) : []);
  const avgContext = $derived(w && w.requests ? w.tokens.context / w.requests : 0);
  const contextShare = $derived(w ? share(w.split, 'context') : 0);

  const toolLabel = (n: string) => splitMcpName(n).tool;
  const entryHref = (sid: string, aid: string | undefined, line: number) => href.session(sid, aid, { line });
</script>

<section class="card win">
  <div class="head">
    <h4>What cost money {label}</h4>
    {#if w}<span class="strong">{usd(w.costUSD)}</span><span class="faint">{w.requests} request{w.requests === 1 ? '' : 's'}</span>{/if}
    <span class="spacer"></span>
    <a class="btn" href={href.session(sessionId, agent, { tab: 'timeline', from, to })} title="Timeline of all agents, zoomed to this time">Open in timeline</a>
    <button class="btn" onclick={onclose} title="Close">✕</button>
  </div>

  {#if error}
    <p class="badge error">{error}</p>
  {:else if !w}
    <p class="muted"><Spinner /> Collecting the requests …</p>
  {:else if !w.requests}
    <p class="muted">No model requests in this time.</p>
  {:else}
    <!-- Wofür bezahlt wurde -->
    <div class="split" role="img" aria-label="Cost split">
      {#each PARTS as p (p.key)}
        {#if w.split[p.key] > 0}<span style:width="{share(w.split, p.key)}%" style:background={p.color} title="{p.label}: {usd(w.split[p.key])}"></span>{/if}
      {/each}
    </div>
    <div class="legend">
      {#each PARTS as p (p.key)}
        <span title={p.hint}><span class="swatch" style:background={p.color}></span>{p.label} <strong>{pctText(share(w.split, p.key))}</strong> <span class="faint">{usd(w.split[p.key])} · {tokens(w.tokens[p.key])} tokens</span></span>
      {/each}
    </div>
    <p class="insight">
      Each request re-read about <strong>{tokens(avgContext)} tokens</strong> of context ({usd(w.split.context / w.requests)} per request).
      {#if contextShare >= 50}Most of the money went into that, not into the commands themselves – a smaller context (<code>/compact</code>, or handing work to a subagent) makes every request cheaper.{/if}
    </p>
    {#if w.rebuilds.count}
      <p class="insight warn">
        <strong>{w.rebuilds.count === 1 ? 'One request' : `${w.rebuilds.count} requests`} rebuilt the cache</strong> ({usd(w.rebuilds.costUSD)}): the whole context was written again
        although little was new. That happens after a pause longer than the cache lifetime, or when the tools or the system prompt change (e.g. loading MCP tools, switching
        model or settings).
      </p>
    {/if}

    <div class="cols">
      <div>
        <h5>By what the answer did</h5>
        <table class="mini">
          <tbody>
            {#each w.byAction as a (a.name)}
              <tr>
                <td class="mono">{a.name === 'Text' ? 'Text answer' : toolLabel(a.name)}</td>
                <td class="bar"><span style:width="{maxAction ? (a.costUSD / maxAction) * 100 : 0}%"></span></td>
                <td class="num">{usd(a.costUSD)}</td>
                <td class="num faint">{a.requests}×</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div>
        <h5>By agent <span class="faint small">click to open its run at this time</span></h5>
        <table class="mini">
          <tbody>
            {#each showAllAgents ? w.byAgent : w.byAgent.slice(0, 10) as a (a.id)}
              <tr>
                <td class="ellipsis"><a href={entryHref(a.sessionId, a.agentId, a.line)} title={a.sublabel ? `${a.label} – ${a.sublabel}` : a.label}>{a.label}{#if a.sublabel}<span class="faint"> · {a.sublabel}</span>{/if}</a></td>
                <td class="bar"><span style:width="{maxAgent ? (a.costUSD / maxAgent) * 100 : 0}%"></span></td>
                <td class="num">{usd(a.costUSD)}</td>
                <td class="num faint">{a.requests}×</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !showAllAgents && w.byAgent.length > 10}<button class="btn" onclick={() => (showAllAgents = true)}>Show all {w.byAgent.length} agents</button>{/if}
      </div>
    </div>

    {#if w.topInputs.length}
      <h5>Biggest additions to the context <span class="faint small">and how often later requests read them again</span></h5>
      <ul class="inputs">
        {#each w.topInputs as x, i (i)}
          <li>
            <span class="badge">{x.kind === 'tool-result' ? toolLabel(x.name ?? '?') : x.kind === 'prompt' ? 'Prompt' : 'Other'}</span>
            <a class="ellipsis" href={entryHref(x.sessionId, x.agentId, x.line)} title={x.summary}>{x.summary || '(no description)'}</a>
            <span class="num">≈ {tokens(x.tokens)}</span>
            <span class="faint nowrap">{x.rereads ? `read ${x.rereads}× later${x.rereadUSD >= 0.01 ? ` ≈ ${usd(x.rereadUSD)}` : ''}` : 'not read again'}</span>
            {#if w.byAgent.length > 1}<a class="faint ellipsis who" href={entryHref(x.sessionId, x.agentId, x.line)}>{x.label}</a>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h5>Requests <span class="faint small">most expensive first</span></h5>
    <ol class="reqs">
      {#each items as r, i (i)}
        <li>
          <a class="req" href={entryHref(r.sessionId, r.agentId, r.line)}>
            <div class="row1">
              <span class="faint mono">{time(r.ts)}</span>
              {#if w.byAgent.length > 1}<span class="ellipsis who">{lanes.get(r.laneId)?.label}</span>{/if}
              <span class="faint">{modelName(r.model)}</span>
              {#if r.cacheRebuild}<span class="badge warn-badge" title="The whole context was written to the cache again">cache rebuilt</span>{/if}
              <span class="mini-split" title="re-read {usd(r.split.context)} · new {usd(r.split.added)} · answer {usd(r.split.output)}">
                {#each PARTS as p (p.key)}<span style:width="{share(r.split, p.key)}%" style:background={p.color}></span>{/each}
              </span>
              <span class="strong num">{usd(r.costUSD)}</span>
            </div>
            <div class="row2">
              {#each r.actions.slice(0, 3) as a, j (j)}
                <span class="action">{#if a.name}<span class="badge">{toolLabel(a.name)}</span>{/if}<span class="ellipsis">{a.summary}</span></span>
              {/each}
              {#if r.actions.length > 3}<span class="faint">+{r.actions.length - 3} more</span>{/if}
            </div>
            <div class="row3 faint small">
              context {tokens(r.tokens.context)} · new {tokens(r.tokens.added)}{#if r.inputs[0]}{' '}(largest: {r.inputs[0].kind === 'tool-result' ? toolLabel(r.inputs[0].name ?? '?') : r.inputs[0].kind} {r.inputs[0].summary.slice(0, 70)} ≈ {tokens(r.inputs[0].tokens)}){/if} · answer {tokens(r.tokens.output)}
            </div>
          </a>
        </li>
      {/each}
    </ol>
    {#if !showAll && w.items.length > items.length}
      <button class="btn" onclick={() => (showAll = true)}>Show all {w.items.length}{w.requests > w.items.length ? ` of ${w.requests}` : ''}</button>
    {/if}
  {/if}
</section>

<style>
  .win {
    margin: 10px 0 16px;
    padding: 12px 14px;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .head h4 {
    margin: 0;
    font-size: 14px;
  }
  .spacer {
    flex: 1;
  }
  h5 {
    margin: 16px 0 6px;
    font-size: 13px;
  }
  .split,
  .mini-split {
    display: flex;
    gap: 2px;
    overflow: hidden;
  }
  .split {
    height: 12px;
    margin: 12px 0 6px;
    border-radius: 4px;
  }
  .split span,
  .mini-split span {
    display: block;
    height: 100%;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    font-size: 12.5px;
  }
  .legend > span {
    display: inline-flex;
    gap: 5px;
    align-items: baseline;
  }
  .insight {
    margin: 10px 0 0;
    font-size: 13px;
  }
  .insight.warn {
    padding: 6px 10px;
    border-left: 3px solid var(--series-4);
    background: var(--surface-2);
    border-radius: 4px;
  }
  .warn-badge {
    color: var(--series-4);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0 28px;
  }
  .mini {
    width: 100%;
    font-size: 12.5px;
    border-collapse: collapse;
  }
  .mini td {
    padding: 3px 6px 3px 0;
  }
  .mini td.ellipsis {
    max-width: 240px;
  }
  .mini .bar {
    width: 40%;
  }
  .mini .bar span {
    display: block;
    height: 8px;
    border-radius: 3px;
    background: var(--series-1);
    min-width: 2px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .nowrap {
    white-space: nowrap;
  }
  .inputs {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 12.5px;
  }
  .inputs li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    gap: 10px;
    align-items: baseline;
    padding: 3px 0;
  }
  .who {
    max-width: 180px;
  }
  .reqs {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }
  .req {
    display: block;
    padding: 6px 8px;
    border-radius: 6px;
    color: inherit;
    text-decoration: none;
    font-size: 12.5px;
  }
  .req:hover {
    background: var(--surface-2);
    text-decoration: none;
  }
  .row1 {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }
  .mini-split {
    width: 90px;
    height: 7px;
    border-radius: 3px;
    margin-left: auto;
    flex: none;
  }
  .row2 {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin-top: 3px;
    min-width: 0;
  }
  .action {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
    min-width: 0;
    max-width: 100%;
  }
  .row3 {
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    .inputs li {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    .inputs .who,
    .inputs li > .faint {
      grid-column: 2 / -1;
    }
  }
</style>
