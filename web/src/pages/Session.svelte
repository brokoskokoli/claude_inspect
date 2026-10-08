<script lang="ts">
  import type { Flow, SessionDetail } from '$shared/types';
  import FlowGraph from '../components/FlowGraph.svelte';
  import TaskBoard from '../components/TaskBoard.svelte';
  import Timeline from '../components/Timeline.svelte';
  import { untrack } from 'svelte';
  import Activity from '../components/Activity.svelte';
  import AgentTree from '../components/AgentTree.svelte';
  import SpawnBadge from '../components/SpawnBadge.svelte';
  import StatusDot from '../components/StatusDot.svelte';
  import Transcript from '../components/Transcript.svelte';
  import ResumeButtons from '../components/ResumeButtons.svelte';
  import { resumeCommands } from '$shared/resume';
  import { api } from '../lib/api';
  import { ago, bytes, dateTime, modelName, shortPath, tokens, usd } from '../lib/format';
  import { clock, live, onTranscript } from '../lib/live.svelte';
  import { href, type SessionTab } from '../lib/router.svelte';

  let { id, agent, tab, tool, line }: { id: string; agent?: string; tab: SessionTab; tool?: string; line?: number } = $props();

  let flow = $state<Flow | null>(null);
  let flowTimer: ReturnType<typeof setTimeout> | undefined;
  async function loadFlow() {
    try {
      flow = await api.flow(id);
    } catch (e) {
      error = String(e);
    }
  }
  // Ablauf nur laden, wenn Zeitleiste oder Graph offen ist; live gedrosselt nachführen
  $effect(() => {
    if (tab !== 'timeline' && tab !== 'graph') return;
    untrack(() => void loadFlow());
    const off = onTranscript(() => {
      if (flowTimer) return;
      flowTimer = setTimeout(() => {
        flowTimer = undefined;
        void loadFlow();
      }, 4000);
    });
    return () => {
      off();
      clearTimeout(flowTimer);
      flowTimer = undefined;
    };
  });

  const TABS: [SessionTab, string][] = [
    ['transcript', 'Transcript'],
    ['timeline', 'Timeline'],
    ['graph', 'Call graph'],
    ['tasks', 'Tasks'],
  ];

  let detail = $state<SessionDetail | null>(null);
  let error = $state('');
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  async function loadDetail() {
    try {
      detail = await api.session(id);
    } catch (e) {
      error = String(e);
    }
  }

  $effect(() => {
    untrack(() => void loadDetail());
    // Subagent-Status aktuell halten (gedrosselt)
    return onTranscript((ev) => {
      if (ev.sessionId !== id || refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void loadDetail();
      }, 2500);
    });
  });

  // phones: the metadata block is collapsed by default (desktop always shows it)
  let metaOpen = $state(false);

  const sum = $derived(detail?.summary);
  const proc = $derived(detail?.process);
  const liveProc = $derived(live.dashboard?.processes.find((p) => p.process.sessionId === id && p.process.alive));
  const isLive = $derived(!!liveProc);
  const mainState = $derived(!isLive ? 'dead' : liveProc?.session?.current?.kind === 'error' ? 'error' : liveProc?.process.status === 'idle' ? 'idle' : 'busy');
  const sel = $derived(agent ? detail?.subagents.find((s) => s.agentId === agent) : undefined);
  const job = $derived(detail?.job);
  const resume = $derived(
    sum && live.dashboard
      ? resumeCommands({ sessionId: sum.sessionId, cwd: sum.cwd, platform: live.dashboard.platform, live: isLive, processKind: proc?.kind, jobShort: job?.short })
      : [],
  );
</script>

{#if error}
  <p class="badge error">{error}</p>
{:else if !detail || !sum || !live.dashboard}
  <p class="muted">Loading …</p>
{:else}
  <div class="crumbs muted"><a href={href.sessions()}>Sessions</a> / {sum.project}</div>
  <header class="head card">
    <div class="title-row">
      <StatusDot state={mainState} size={11} />
      <h1>{proc?.name ?? sum.title ?? sum.sessionId}</h1>
      {#if isLive}<span class="badge accent">live</span>{/if}
      {#if proc?.kind}<span class="badge">{proc.kind}</span>{/if}
      {#if proc?.agent}<span class="badge info">{proc.agent}</span>{/if}
      {#if proc?.bridgeSessionId}<span class="badge info">remote</span>{/if}
    </div>
    {#if proc?.name && sum.title && sum.title !== proc.name}<div class="muted">{sum.title}</div>{/if}
    {#if detail.spawnedBy}
      {@const by = detail.spawnedBy}
      <div class="spawned-by">
        <span class="muted">⇠ started via <code>claude</code> call by</span>
        <a href={href.session(by.parentSessionId, by.parentAgentId)}>{by.parentTitle ?? by.parentSessionId.slice(0, 8)}</a>
        {#if by.parentAgentId}<span class="faint">(subagent {by.parentAgentId.slice(0, 8)})</span>{/if}
        <SpawnBadge link={by} />
        <span class="faint small">{by.evidence.join(' · ')}</span>
      </div>
    {/if}
    {#if isLive && liveProc?.session?.current}
      <div class="now"><Activity activity={liveProc.session.current} /></div>
    {/if}
    <button class="meta-toggle" aria-expanded={metaOpen} onclick={() => (metaOpen = !metaOpen)}>{metaOpen ? '▾' : '▸'} Details</button>
    <dl class:collapsed={!metaOpen}>
      <div><dt>Directory</dt><dd class="mono">{shortPath(sum.cwd)}</dd></div>
      {#if sum.gitBranch}<div><dt>Branch</dt><dd class="mono">{sum.gitBranch}</dd></div>{/if}
      <div><dt>Time range</dt><dd>{dateTime(sum.firstTimestamp)} – {dateTime(sum.lastTimestamp)} <span class="faint">({ago(sum.lastTimestamp, clock.now)})</span></dd></div>
      <div><dt>Model</dt><dd>{modelName(liveProc?.session?.model ?? sum.model)}{liveProc?.session?.effort ? ` · ${liveProc.session.effort}` : ''}</dd></div>
      {#if liveProc?.session}
        <div><dt>Context</dt><dd>{tokens(liveProc.session.contextTokens)} tokens</dd></div>
        <div><dt>Permission</dt><dd class="mono">{liveProc.session.permissionMode ?? '–'}</dd></div>
      {/if}
      {#if sum.costUSD !== undefined}<div><dt>Cost</dt><dd>{usd(sum.costUSD)}</dd></div>{/if}
      <div><dt>Versions</dt><dd class="mono">{sum.versions.join(', ') || '–'}</dd></div>
      {#if proc}<div><dt>Process</dt><dd class="mono">pid {proc.pid} · {proc.entrypoint ?? '?'} {proc.alive ? '' : '(ended)'}</dd></div>{/if}
      {#if job}
        <div>
          <dt>Job</dt>
          <dd><span class="mono">{job.short}</span> · {job.state}{job.detail ? ` – ${job.detail}` : ''}</dd>
        </div>
        {@const from = job.fork?.parentSessionId ?? job.launch?.fromSessionId}
        {@const isFork = !!(job.launch?.fork || job.fork)}
        {#if from && from !== id}
          <div><dt>{isFork ? 'Fork of' : 'Resumed from'}</dt><dd><a class="mono" href={href.session(from)}>{from.slice(0, 8)}</a></dd></div>
        {:else if from === id && job.sessionId && job.sessionId !== id}
          <!-- Der Job ist ein Fork *dieser* Session (z. B. in den Hintergrund geparkt) -->
          {@const target = job.resumeSessionId ?? job.sessionId}
          <div><dt>{isFork ? 'Forked into' : 'Resumed in'}</dt><dd><a class="mono" href={href.session(target)}>{job.name ?? target.slice(0, 8)}</a></dd></div>
        {/if}
      {/if}
      <div><dt>File</dt><dd class="mono faint">{sum.sessionId}.jsonl · {bytes(sum.size)}</dd></div>
    </dl>
    {#if resume.length}<div class="resume-row"><ResumeButtons commands={resume} /></div>{/if}
  </header>

  <nav class="tabs">
    {#each TABS as [key, label] (key)}
      <a href={href.session(id, key === 'transcript' ? agent : undefined, { tab: key })} class:on={tab === key}>
        {label}{#if key === 'tasks' && detail.tasks.length}<span class="n">{detail.tasks.length}</span>{/if}
        {#if key === 'graph' && detail.subagents.length + detail.spawned.length}<span class="n">{detail.subagents.length + detail.spawned.length + 1}</span>{/if}
      </a>
    {/each}
  </nav>

  {#if tab === 'timeline'}
    {#if flow}<Timeline {flow} />{:else}<p class="muted">Loading flow …</p>{/if}
  {:else if tab === 'graph'}
    {#if flow}<FlowGraph {flow} />{:else}<p class="muted">Loading flow …</p>{/if}
  {:else if tab === 'tasks'}
    <TaskBoard tasks={detail.tasks} />
  {:else}
  <div class="layout">
    <aside>
      <div class="aside-head muted">
        Agents <span class="faint">{detail.subagents.length + 1}{detail.spawned.length ? ` + ${detail.spawned.length} spawned` : ''}</span>
      </div>
      <AgentTree sessionId={id} subagents={detail.subagents} spawned={detail.spawned} selected={agent} {mainState} mainLabel={sum.title ?? sum.project} />
    </aside>
    <section class="main">
      {#if sel}
        <div class="sub-head card">
          <StatusDot state={sel.status} size={9} />
          <div>
            <div><strong>{sel.agentType ?? 'Subagent'}</strong> <span class="muted">{sel.description}</span></div>
            <div class="faint small">
              {modelName(sel.model)} · {sel.toolCalls ?? 0} tools · {tokens(sel.outputTokens)} output tokens · depth {sel.spawnDepth ?? 1}
              {#if sel.background}· background{/if}
            </div>
          </div>
          <a class="back" href={href.session(id)}>← Main agent</a>
        </div>
      {/if}
      {#key `${agent}|${tool}|${line}`}
        <Transcript sessionId={id} agentId={agent} subagents={detail.subagents} spawned={detail.spawned} live={isLive} focusTool={tool} focusLine={line} />
      {/key}
    </section>
  </div>
  {/if}
{/if}

<style>
  .resume-row {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .spawned-by {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--border);
    margin: -4px 0 14px;
  }
  .tabs a {
    padding: 7px 14px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    text-decoration: none;
    font-weight: 500;
  }
  .tabs a:hover {
    color: var(--text);
  }
  .tabs a.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .n {
    margin-left: 6px;
    font-size: 11px;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .crumbs {
    font-size: 12.5px;
    margin-bottom: 8px;
  }
  .head {
    padding: 14px 18px;
    margin-bottom: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  h1 {
    font-size: 19px;
  }
  .now {
    padding: 7px 10px;
    background: var(--surface-2);
    border-radius: 7px;
    max-width: 900px;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr));
    gap: 6px 20px;
    margin: 6px 0 0;
  }
  dl div {
    min-width: 0;
  }
  dt {
    font-size: 11.5px;
    color: var(--faint);
  }
  dd {
    margin: 0;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .layout {
    display: grid;
    grid-template-columns: 290px minmax(0, 1fr);
    min-width: 0;
    gap: 20px;
    align-items: start;
  }
  aside {
    position: sticky;
    top: 64px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    overflow-x: hidden;
  }
  .aside-head {
    font-size: 12px;
    margin: 0 0 6px 8px;
  }
  .sub-head {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    margin-bottom: 8px;
  }
  .back {
    margin-left: auto;
    white-space: nowrap;
  }
  .meta-toggle {
    display: none;
  }
  dd {
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 12px;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    aside {
      position: static;
      max-height: 300px;
    }
  }
  @media (max-width: 640px) {
    .head {
      padding: 12px 14px;
    }
    h1 {
      font-size: 17px;
      overflow-wrap: anywhere;
    }
    .meta-toggle {
      display: block;
      align-self: flex-start;
      min-height: 44px;
      padding: 0 2px;
      border: none;
      background: none;
      color: var(--muted);
      font-size: 14px;
    }
    dl {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 14px;
      margin: 0;
    }
    dl.collapsed {
      display: none;
    }
    dl > div:last-child {
      grid-column: 1 / -1;
    }
    dd {
      font-size: 14px;
    }
    .tabs {
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs a {
      display: flex;
      align-items: center;
      min-height: 44px;
      padding: 0 12px;
      white-space: nowrap;
    }
    .sub-head {
      flex-wrap: wrap;
    }
    .back {
      min-height: 44px;
      display: flex;
      align-items: center;
    }
  }
</style>
