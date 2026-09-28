<script lang="ts">
  import type { Flow, FlowLane } from '$shared/types';
  import { duration, modelName, tokens } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';

  let { flow }: { flow: Flow } = $props();

  const W = 236;
  const H = 64;
  const COL = 290;
  const ROWH = 78;

  // Baum-Layout: x nach Tiefe, y nach Blatt-Reihenfolge (Eltern mittig über ihren Kindern)
  const layout = $derived.by(() => {
    const kids = new Map<string | undefined, FlowLane[]>();
    for (const l of flow.lanes) kids.set(l.parentId, [...(kids.get(l.parentId) ?? []), l]);
    for (const list of kids.values()) list.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    const pos = new Map<string, { x: number; y: number; col: number }>();
    let leaf = 0;
    const offset = flow.origin ? 1 : 0;
    const place = (l: FlowLane, col: number): number => {
      const children = kids.get(l.id) ?? [];
      let y: number;
      if (!children.length) y = leaf++ * ROWH;
      else {
        const ys = children.map((c) => place(c, col + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      pos.set(l.id, { x: (col + offset) * COL, y, col });
      return y;
    };
    for (const root of kids.get(undefined) ?? []) place(root, 0);
    const maxCol = Math.max(0, ...[...pos.values()].map((p) => p.col)) + offset;
    return { pos, width: (maxCol + 1) * COL - (COL - W) + 16, height: Math.max(1, leaf) * ROWH - (ROWH - H) + 16 };
  });

  const rootPos = $derived(layout.pos.get(flow.rootSessionId));
  const dur = (l: FlowLane) => (l.start !== undefined ? duration((l.status === 'running' ? clock.now : (l.end ?? l.start)) - l.start) : '');
  const kindLabel: Record<FlowLane['kind'], string> = { main: 'Main agent', subagent: 'Subagent', spawn: 'Spawned' };

  function edge(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const x1 = from.x + W;
    const y1 = from.y + H / 2;
    const x2 = to.x;
    const y2 = to.y + H / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }
</script>

<div class="legend">
  <span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" class="e subagent" /></svg> Subagent (Agent tool)</span>
  <span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" class="e spawn" /></svg> own session via <code>claude</code> call</span>
  {#if flow.origin}<span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" class="e origin" /></svg> {flow.origin.kind === 'fork' ? 'Fork' : 'Resume'}</span>{/if}
  <span class="faint">grey = finished</span>
</div>

<div class="graph card">
  <svg width={layout.width} height={layout.height} role="img" aria-label="Call graph">
    <g transform="translate(8,8)">
      {#each flow.lanes as l (l.id)}
        {#if l.parentId && layout.pos.has(l.parentId)}
          <path d={edge(layout.pos.get(l.parentId)!, layout.pos.get(l.id)!)} class="e {l.kind}" />
        {/if}
      {/each}
      {#if flow.origin && rootPos}
        <path d={edge({ x: 0, y: rootPos.y }, rootPos)} class="e origin" />
      {/if}
    </g>
  </svg>
  <div class="nodes" style:width="{layout.width}px" style:height="{layout.height}px">
    {#if flow.origin && rootPos}
      <a class="node origin" style:left="8px" style:top="{rootPos.y + 8}px" style:width="{W}px" style:height="{H}px" href={href.session(flow.origin.sessionId)}>
        <div class="k">{flow.origin.kind === 'fork' ? 'Fork of' : 'Resumed from'}</div>
        <div class="t ellipsis">{flow.origin.title ?? flow.origin.sessionId.slice(0, 8)}</div>
      </a>
    {/if}
    {#each flow.lanes as l (l.id)}
      {@const p = layout.pos.get(l.id)}
      {#if p}
        <a
          class="node {l.kind} st-{l.status}"
          class:finished={l.status === 'done' || l.status === 'stale'}
          style:left="{p.x + 8}px"
          style:top="{p.y + 8}px"
          style:width="{W}px"
          style:height="{H}px"
          href={href.session(l.sessionId, l.agentId)}
          title={[l.sublabel, l.confidence ? `match ${l.confidence}` : ''].filter(Boolean).join(' · ')}
        >
          <div class="k">
            <span class="dot"></span>{kindLabel[l.kind]}{#if l.sublabel && l.kind !== 'main'}<span class="sl">· {l.sublabel}</span>{/if}
            <span class="d">{dur(l)}</span>
          </div>
          <div class="t ellipsis">{l.label}</div>
          <div class="s ellipsis">{modelName(l.model)} · {l.toolCalls} tools · {tokens(l.outputTokens)} out</div>
        </a>
      {/if}
    {/each}
  </div>
</div>

<style>
  .legend {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: center;
    font-size: 12px;
    color: var(--muted);
    margin: 4px 0 10px;
  }
  .legend > span {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .graph {
    position: relative;
    overflow: auto;
    max-height: 75vh;
  }
  .graph > svg {
    position: absolute;
    left: 0;
    top: 0;
  }
  .nodes {
    position: relative;
  }
  .e {
    fill: none;
    stroke: var(--faint);
    stroke-width: 1.5;
  }
  .e.spawn {
    stroke: var(--info);
    stroke-dasharray: 5 4;
  }
  .e.origin {
    stroke: var(--accent);
    stroke-dasharray: 2 4;
  }
  .node {
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 6px 10px;
    border-radius: 9px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
    box-shadow: var(--shadow);
  }
  .node:hover {
    border-color: var(--accent);
    text-decoration: none;
  }
  .node.main {
    border-width: 2px;
  }
  .node.spawn {
    border-color: color-mix(in srgb, var(--info) 45%, var(--border));
  }
  .node.finished {
    background: var(--surface-2);
    box-shadow: none;
  }
  .node.finished .t {
    color: var(--muted);
  }
  .node.origin {
    border-style: dashed;
    background: var(--surface-2);
  }
  .k {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--faint);
  }
  .k {
    white-space: nowrap;
    min-width: 0;
  }
  .sl {
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: 0;
    min-width: 0;
  }
  .d {
    flex: none;
    margin-left: auto;
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--dead);
  }
  .st-running .dot {
    background: var(--busy);
  }
  .st-idle .dot {
    background: var(--idle);
  }
  .st-error .dot {
    background: var(--error);
  }
  .st-done .dot {
    background: color-mix(in srgb, var(--busy) 45%, var(--dead));
  }
  .t {
    font-weight: 600;
    font-size: 13px;
  }
  .s {
    font-size: 11.5px;
    color: var(--faint);
  }
</style>
