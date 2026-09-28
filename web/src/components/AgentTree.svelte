<script lang="ts">
  import type { SpawnedSession, SubagentInfo } from '$shared/types';
  import { ago, modelName, tokens } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';
  import SpawnBadge from './SpawnBadge.svelte';
  import StatusDot from './StatusDot.svelte';

  let {
    sessionId,
    subagents,
    spawned,
    selected,
    mainState,
    mainLabel,
  }: {
    sessionId: string;
    subagents: SubagentInfo[];
    spawned: SpawnedSession[];
    selected?: string;
    mainState: 'busy' | 'idle' | 'dead' | 'error';
    mainLabel: string;
  } = $props();

  type Node = { kind: 'sub'; a: SubagentInfo } | { kind: 'spawn'; c: SpawnedSession };

  // Kinder je Agent (undefined = Hauptagent): Subagenten und per claude-Aufruf gestartete Sitzungen,
  // zeitlich sortiert.
  const children = $derived.by(() => {
    const m = new Map<string | undefined, Node[]>();
    const ids = new Set(subagents.map((s) => s.agentId));
    const add = (parent: string | undefined, n: Node) => m.set(parent, [...(m.get(parent) ?? []), n]);
    for (const a of subagents) add(a.parentAgentId && ids.has(a.parentAgentId) ? a.parentAgentId : undefined, { kind: 'sub', a });
    for (const c of spawned) add(c.parentAgentId && ids.has(c.parentAgentId) ? c.parentAgentId : undefined, { kind: 'spawn', c });
    const when = (n: Node) => (n.kind === 'sub' ? n.a.lastActivityAt : n.c.lastActivityAt) ?? '';
    for (const list of m.values()) list.sort((x, y) => when(x).localeCompare(when(y)));
    return m;
  });
</script>

{#snippet node(n: Node, depth: number)}
  {#if n.kind === 'sub'}
    {@const a = n.a}
    <li>
      <a
        class="node"
        class:sel={selected === a.agentId}
        class:finished={a.status !== 'running'}
        href={href.session(sessionId, a.agentId)}
        style:padding-left="{8 + depth * 14}px"
      >
        <StatusDot state={a.status} size={7} />
        <span class="body">
          <span class="line1">
            <span class="type">{a.agentType ?? 'agent'}</span>
            {#if a.background}<span class="tag" title="background">bg</span>{/if}
            {#if a.status === 'done'}<span class="tag done">finished</span>{/if}
            <span class="faint when">{ago(a.lastActivityAt, clock.now)}</span>
          </span>
          <span class="desc">{a.status === 'running' && a.current ? a.current.label : (a.description ?? a.agentId)}</span>
          <span class="faint stats">{modelName(a.model)} · {a.toolCalls ?? 0} tools · {tokens(a.outputTokens)} out</span>
        </span>
      </a>
      {#if children.get(a.agentId)?.length}
        <ul>
          {#each children.get(a.agentId) ?? [] as c (c.kind === 'sub' ? c.a.agentId : c.c.childSessionId)}{@render node(c, depth + 1)}{/each}
        </ul>
      {/if}
    </li>
  {:else}
    {@const c = n.c}
    <li>
      <a class="node spawn" class:finished={c.status === 'done'} href={href.session(c.childSessionId)} style:padding-left="{8 + depth * 14}px">
        <StatusDot state={c.status === 'running' ? 'running' : c.status === 'idle' ? 'idle' : 'done'} size={7} />
        <span class="body">
          <span class="line1">
            <span class="type">⇢ {c.agent ?? 'claude'}</span>
            <SpawnBadge link={c} />
            {#if c.status === 'done'}<span class="tag done">finished</span>{/if}
            <span class="faint when">{ago(c.lastActivityAt, clock.now)}</span>
          </span>
          <span class="desc">{c.status !== 'done' && c.current ? c.current.label : (c.title ?? c.childSessionId)}</span>
          <span class="faint stats">own session · {modelName(c.model)}{c.pid ? ` · pid ${c.pid}` : ''}</span>
        </span>
      </a>
    </li>
  {/if}
{/snippet}

<nav class="tree">
  <ul>
    <li>
      <a class="node main" class:sel={!selected} href={href.session(sessionId)}>
        <StatusDot state={mainState} size={8} />
        <span class="body"><span class="type">Main agent</span><span class="desc">{mainLabel}</span></span>
      </a>
      {#if children.get(undefined)?.length}
        <ul>
          {#each children.get(undefined) ?? [] as c (c.kind === 'sub' ? c.a.agentId : c.c.childSessionId)}{@render node(c, 1)}{/each}
        </ul>
      {/if}
    </li>
  </ul>
</nav>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li,
  ul ul {
    margin-top: 2px;
  }
  .node {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 8px;
    border-radius: 7px;
    color: inherit;
    text-decoration: none;
    border: 1px solid transparent;
  }
  .node :global(.dot) {
    margin-top: 6px;
  }
  .node :global(.mark) {
    margin-top: 3px;
  }
  .node:hover {
    border-color: var(--border);
    text-decoration: none;
  }
  /* abgeschlossen: grau hinterlegt, gedämpfte Schrift */
  .node.finished {
    background: var(--surface-2);
  }
  .node.finished .type,
  .node.finished .desc {
    color: var(--faint);
  }
  .node.finished .type {
    font-weight: 500;
  }
  .node.sel {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .node.sel .type,
  .node.sel .desc {
    color: var(--text);
  }
  .node.spawn .type {
    color: var(--info);
  }
  .node.spawn.finished .type {
    color: var(--faint);
  }
  .body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .line1 {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 6px;
    align-items: baseline;
    min-width: 0;
  }
  .type {
    font-weight: 600;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .tag {
    font-size: 10.5px;
    color: var(--info);
  }
  .tag.done {
    color: var(--faint);
  }
  .when {
    margin-left: auto;
    font-size: 11px;
    white-space: nowrap;
  }
  .desc {
    font-size: 12.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .stats {
    font-size: 11px;
  }
</style>
