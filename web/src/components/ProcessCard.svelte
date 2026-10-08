<script lang="ts">
  import type { DashboardProcess, SubagentInfo } from '$shared/types';
  import { splitMcpName } from '$shared/tools';
  import { ago, duration, modelName, shortPath, toMs, tokens, usd } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';
  import Activity from './Activity.svelte';
  import SpawnBadge from './SpawnBadge.svelte';
  import StatusDot from './StatusDot.svelte';

  let { item }: { item: DashboardProcess } = $props();

  const p = $derived(item.process);
  const s = $derived(item.session);
  const job = $derived(item.job);
  const state = $derived(!p.alive ? 'dead' : s?.current?.kind === 'error' ? 'error' : p.status === 'idle' ? 'idle' : 'busy');
  const title = $derived(p.name ?? s?.title ?? p.sessionId.slice(0, 8));
  const subtitle = $derived(p.name && s?.title && s.title !== p.name ? s.title : undefined);
  const running = $derived(s?.subagents.filter((a) => a.status === 'running') ?? []);
  const others = $derived(s?.subagents.filter((a) => a.status !== 'running').slice(-4).reverse() ?? []);
  // Job-Details nur zeigen, wenn der Job zu *diesem* Prozess gehört (nicht nur "geparkt").
  const ownJob = $derived(job && p.jobId === job.short ? job : undefined);

  function subState(a: SubagentInfo) {
    return a.status;
  }

  const spawnedRunning = $derived(s?.spawned.filter((c) => c.status !== 'done') ?? []);
  const spawnedDone = $derived(s?.spawned.filter((c) => c.status === 'done').slice(-3).reverse() ?? []);
  const spawnedBy = $derived(item.spawnedBy);
</script>

<a class="card proc {state}" href={href.session(p.sessionId)}>
  <div class="head">
    <StatusDot {state} size={10} />
    <div class="titles">
      <div class="title ellipsis">{title}</div>
      {#if subtitle}<div class="subtitle ellipsis">{subtitle}</div>{/if}
    </div>
    <div class="badges">
      {#if p.kind}<span class="badge" class:accent={p.kind === 'bg'}>{p.kind === 'bg' ? 'background' : p.kind}</span>{/if}
      {#if p.agent}<span class="badge info" title="Agent definition">{p.agent}</span>{/if}
      {#if p.bridgeSessionId}<span class="badge info" title="Remote Control active">remote</span>{/if}
    </div>
  </div>

  {#if spawnedBy}
    <div class="parent">
      <span class="muted">started by</span>
      <!-- the card itself is a link, so a button instead of <a> -->
      <button
        class="link"
        onclick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          location.hash = href.session(spawnedBy.parentSessionId, spawnedBy.parentAgentId);
        }}>{spawnedBy.parentTitle ?? spawnedBy.parentSessionId.slice(0, 8)}</button
      >
      <SpawnBadge link={spawnedBy} />
    </div>
  {/if}

  <div class="where muted">
    <span class="ellipsis" title={p.cwd}>{shortPath(p.cwd)}</span>
    {#if s?.gitBranch}<span class="branch">⎇ {s.gitBranch}</span>{/if}
  </div>

  {#if p.alive && s?.current}
    <div class="now">
      <Activity activity={s?.current} />
      {#each s?.pendingTools.slice(0, -1) ?? [] as t (t.toolUseId)}
        <div class="pending">
          <span class="tool">{splitMcpName(t.name).tool}</span>
          <span class="ellipsis">{t.summary}</span>
          <span class="since">{duration(clock.now - (toMs(t.since) ?? clock.now))}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if ownJob && (ownJob.detail || ownJob.fan.length)}
    <div class="job">
      <div class="job-head">
        <span class="badge">Job {ownJob.short}</span>
        <span class="muted">{ownJob.state}{ownJob.tempo ? ` · ${ownJob.tempo}` : ''}</span>
      </div>
      {#if ownJob.detail}<div class="job-detail">{ownJob.detail}</div>{/if}
      {#each ownJob.fan as f (f.id)}
        <div class="pending">
          <span class="tool">{f.kind}</span>
          <span class="ellipsis mono">{f.label}</span>
          {#if f.startedAt}<span class="since">{duration(clock.now - f.startedAt)}</span>{/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if s && (running.length || others.length)}
    <div class="subs">
      <div class="subs-head muted">
        Subagents
        <span class="faint">{running.length} active · {s.subagentTotal} total</span>
      </div>
      {#each [...running, ...others] as a (a.agentId)}
        <div class="sub" class:finished={a.status !== 'running'}>
          <StatusDot state={subState(a)} size={7} />
          <span class="sub-type">{a.agentType ?? 'agent'}</span>
          <span class="ellipsis">{a.status === 'running' && a.current ? a.current.label : a.description}</span>
          <span class="since">{a.status === 'running' ? '' : ago(a.lastActivityAt, clock.now)}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if s && s.spawned.length}
    <div class="subs">
      <div class="subs-head muted">
        Spawned sessions
        <span class="faint">{spawnedRunning.length} active · {s.spawned.length} total</span>
      </div>
      {#each [...spawnedRunning, ...spawnedDone] as c (c.childSessionId)}
        <div class="sub" class:finished={c.status === 'done'}>
          <StatusDot state={c.status === 'running' ? 'running' : c.status === 'idle' ? 'idle' : 'done'} size={7} />
          <span class="sub-type">{c.agent ?? 'claude'}</span>
          <span class="ellipsis">{c.status !== 'done' && c.current ? c.current.label : (c.title ?? c.childSessionId.slice(0, 8))}</span>
          <span class="since">{c.status === 'done' ? ago(c.lastActivityAt, clock.now) : ''}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="metrics">
    {#if s}
      <span title="Model">{modelName(s.model)}{s.effort ? ` · ${s.effort}` : ''}</span>
      <span title="Context (input tokens of the last request)">ctx {tokens(s.contextTokens)}</span>
      <span title="Output tokens total">out {tokens(s.outputTokens)}</span>
      <span title="Tool calls">{s.toolCalls} tools</span>
      {#if s.costUSD !== undefined}<span>{usd(s.costUSD)}</span>{/if}
      {#if s.permissionMode}<span class="perm" title="Permission-Mode">{s.permissionMode}</span>{/if}
    {:else}
      <span class="faint">{p.alive ? 'no transcript found' : `ended · last seen ${ago(p.updatedAt ?? p.startedAt, clock.now)}`}</span>
    {/if}
    <span class="ver faint">v{p.version} · pid {p.pid}</span>
  </div>
</a>

<style>
  .proc {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px 12px;
    color: inherit;
    text-decoration: none;
    min-width: 0;
    transition: border-color 0.15s;
  }
  .proc:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    text-decoration: none;
  }
  .proc.busy {
    border-top: 3px solid var(--busy);
  }
  .proc.idle {
    border-top: 3px solid var(--idle);
  }
  .proc.error {
    border-top: 3px solid var(--error);
  }
  .proc.dead {
    opacity: 0.65;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .titles {
    min-width: 0;
    flex: 1;
  }
  .title {
    font-weight: 600;
    font-size: 15px;
  }
  .subtitle {
    font-size: 12.5px;
    color: var(--muted);
  }
  .badges {
    display: flex;
    gap: 4px;
    flex: none;
  }
  /* phones: badges move below the title so the name stays readable */
  @media (max-width: 480px) {
    .head {
      flex-wrap: wrap;
    }
    .titles {
      flex: 1 1 calc(100% - 20px);
    }
    .badges {
      flex-wrap: wrap;
      padding-left: 19px;
    }
  }
  .where {
    display: flex;
    gap: 10px;
    font-size: 12.5px;
    min-width: 0;
  }
  .branch {
    flex: none;
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .now {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    background: var(--surface-2);
    border-radius: 7px;
  }
  .pending {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
    font-size: 12.5px;
    padding-left: 23px;
  }
  .tool {
    flex: none;
    font-family: var(--mono);
    font-size: 11.5px;
    font-weight: 600;
    color: var(--accent);
  }
  .since {
    flex: none;
    margin-left: auto;
    font-size: 11.5px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .job {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
  }
  .job-head {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .job-detail {
    color: var(--text);
  }
  .job .pending {
    padding-left: 0;
  }
  .subs {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
  }
  .subs-head {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .sub-type {
    flex: none;
    font-weight: 500;
  }
  /* abgeschlossene Subagenten/Aufrufe: grau hinterlegt */
  .sub {
    padding: 1px 6px;
    margin: 0 -6px;
    border-radius: 5px;
  }
  .sub.finished {
    background: var(--surface-2);
    color: var(--faint);
  }
  .sub.finished .sub-type {
    font-weight: 400;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font-weight: 500;
  }
  .link:hover {
    text-decoration: underline;
  }
  .parent {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    margin-top: -4px;
  }
  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .perm {
    font-family: var(--mono);
    font-size: 11px;
  }
  .ver {
    margin-left: auto;
  }
</style>
