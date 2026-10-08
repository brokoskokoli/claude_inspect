<script lang="ts">
  import type { Flow, FlowLane, FlowSpan } from '$shared/types';
  import { splitMcpName } from '$shared/tools';
  import { TOOL_CATEGORIES, toolColor } from '../lib/colors';
  import { duration, time } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';
  import StatusDot from './StatusDot.svelte';

  let { flow }: { flow: Flow } = $props();

  const ROW = 30;
  const AXIS = 26;
  const GAP_PX = 28;
  const GAP_MIN_MS = 10 * 60_000;

  let viewportW = $state(900);
  let zoom = $state(1);
  let compress = $state(true);
  let hover = $state<{ lane: FlowLane; span?: FlowSpan; x: number; y: number } | null>(null);

  // Lanes in Baumreihenfolge (Tiefensuche, Kinder nach Startzeit)
  const lanes = $derived.by(() => {
    const kids = new Map<string | undefined, FlowLane[]>();
    for (const l of flow.lanes) kids.set(l.parentId, [...(kids.get(l.parentId) ?? []), l]);
    for (const list of kids.values()) list.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    const out: FlowLane[] = [];
    const visit = (l: FlowLane) => {
      out.push(l);
      for (const c of kids.get(l.id) ?? []) visit(c);
    };
    for (const root of kids.get(undefined) ?? []) visit(root);
    return out;
  });
  const rowOf = $derived(new Map(lanes.map((l, i) => [l.id, i])));

  const endOf = (l: FlowLane) => (l.status === 'running' ? clock.now : (l.end ?? l.start ?? 0));
  const spanEnd = (s: FlowSpan, l: FlowLane) => s.end ?? (l.status === 'running' ? clock.now : s.start);

  // Aktive Zeitabschnitte; Pausen > 10 min werden auf eine feste Breite zusammengeschoben.
  const segments = $derived.by(() => {
    const iv: [number, number][] = [];
    for (const l of flow.lanes) {
      if (l.start !== undefined) iv.push([l.start, l.start]);
      iv.push([endOf(l), endOf(l)]);
      for (const s of l.spans) iv.push([s.start, spanEnd(s, l)]);
      for (const t of l.turns) iv.push([t, t]);
    }
    iv.sort((a, b) => a[0] - b[0]);
    const segs: { from: number; to: number }[] = [];
    for (const [a, b] of iv) {
      const last = segs.at(-1);
      if (last && (!compress || a - last.to <= GAP_MIN_MS)) last.to = Math.max(last.to, b);
      else segs.push({ from: a, to: b });
    }
    return segs;
  });

  const activeMs = $derived(segments.reduce((s, x) => s + Math.max(x.to - x.from, 1000), 0));
  const gaps = $derived(Math.max(0, segments.length - 1));
  const fitPxPerMs = $derived(Math.max(1e-6, (viewportW - 24 - gaps * GAP_PX) / activeMs));
  const pxPerMs = $derived(fitPxPerMs * zoom);
  const totalW = $derived(Math.max(viewportW - 2, activeMs * pxPerMs + gaps * GAP_PX + 12));

  function x(t: number): number {
    let off = 6;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const w = Math.max(s.to - s.from, 1000) * pxPerMs;
      if (t <= s.to || i === segments.length - 1) return off + Math.min(Math.max(t - s.from, 0), Math.max(s.to - s.from, 1000)) * pxPerMs;
      off += w + GAP_PX;
      if (t < segments[i + 1].from) return off - GAP_PX / 2; // mitten in der Pause
    }
    return off;
  }

  // Zeitachse: Ticks je Abschnitt in einem sinnvollen Raster
  const ticks = $derived.by(() => {
    const steps = [60e3, 5 * 60e3, 10 * 60e3, 30 * 60e3, 3600e3, 3 * 3600e3, 6 * 3600e3];
    const step = steps.find((s) => s * pxPerMs >= 70) ?? 12 * 3600e3;
    const out: { t: number; label: string; show: boolean }[] = [];
    let lastX = -Infinity;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const segEnd = x(s.to);
      for (let t = Math.ceil(s.from / step) * step; t <= s.to; t += step) {
        const px = x(t);
        // Beschriftung nur mit Abstand zur vorherigen und zur nächsten Pausen-Markierung
        const show = px - lastX >= 48 && (i === segments.length - 1 || segEnd - px >= 40);
        if (show) lastX = px;
        out.push({ t, label: time(t).slice(0, 5), show });
      }
    }
    return out;
  });
  const gapMarks = $derived(
    segments.slice(1).map((s, i) => ({ x: x(segments[i].to) + GAP_PX / 2, pause: s.from - segments[i].to })),
  );

  function open(lane: FlowLane, span?: FlowSpan) {
    location.hash = href.session(lane.sessionId, lane.agentId, span ? { tool: span.toolUseId } : {});
  }
</script>

<div class="toolbar">
  <div class="legend">
    {#each TOOL_CATEGORIES as c (c.key)}<span><span class="swatch" style:background={c.color}></span>{c.label}</span>{/each}
    <span><span class="swatch err"></span>Error</span>
  </div>
  <div class="controls">
    <label class="chk"><input type="checkbox" bind:checked={compress} /> Collapse pauses &gt; 10 min</label>
    <div class="seg">
      <button onclick={() => (zoom = Math.max(1, zoom / 2))} disabled={zoom <= 1}>−</button>
      <button onclick={() => (zoom = 1)} class:on={zoom === 1}>Fit</button>
      <button onclick={() => (zoom = Math.min(256, zoom * 2))}>+</button>
    </div>
  </div>
</div>

<div class="tl card">
  <div class="labels">
    <div class="axis-space"></div>
    {#each lanes as l (l.id)}
      <button class="lane-label {l.kind}" class:finished={l.status === 'done' || l.status === 'stale'} style:padding-left="{8 + l.depth * 12}px" onclick={() => open(l)}>
        <StatusDot state={l.status} size={7} />
        <span class="ll-main ellipsis">{l.kind === 'spawn' ? '⇢ ' : ''}{l.label}</span>
        <span class="ll-sub faint ellipsis">{l.sublabel ?? ''}</span>
      </button>
    {/each}
  </div>
  <div class="scroller" bind:clientWidth={viewportW}>
    <svg width={totalW} height={AXIS + lanes.length * ROW + 6} onmouseleave={() => (hover = null)} role="img" aria-label="Agent timeline">
      <!-- Zeitachse -->
      {#each ticks as tk, i (i)}
        <line x1={x(tk.t)} x2={x(tk.t)} y1={AXIS - 4} y2={AXIS + lanes.length * ROW} class="grid" />
        {#if tk.show}<text x={x(tk.t) + 3} y={AXIS - 9} class="tick">{tk.label}</text>{/if}
      {/each}
      {#each gapMarks as g, i (i)}
        <g transform="translate({g.x},0)">
          <rect x={-GAP_PX / 2 + 3} y={AXIS - 2} width={GAP_PX - 6} height={lanes.length * ROW + 4} class="gap" />
          <text x="0" y={AXIS - 9} class="tick gap-label" text-anchor="middle">{duration(g.pause).replace(/ .*/, '')}</text>
        </g>
      {/each}

      {#each lanes as l, r (l.id)}
        {@const y0 = AXIS + r * ROW}
        <!-- aktiver Zeitraum der Lane -->
        {#if l.start !== undefined}
          <rect x={x(l.start)} y={y0 + 9} width={Math.max(2, x(endOf(l)) - x(l.start))} height={ROW - 18} rx="3" class="lane-bg" class:finished={l.status !== 'running' && l.status !== 'idle'} />
        {/if}
        <!-- Aufruf-Verbindung vom Eltern-Agenten -->
        {#if l.parentId && rowOf.has(l.parentId) && l.start !== undefined}
          {@const pr = rowOf.get(l.parentId)!}
          <line x1={x(l.start)} x2={x(l.start)} y1={AXIS + pr * ROW + ROW / 2} y2={y0 + ROW / 2} class="link {l.kind}" />
          <circle cx={x(l.start)} cy={AXIS + pr * ROW + ROW / 2} r="3" class="link-dot {l.kind}" />
        {/if}
        <!-- Modell-Antworten -->
        {#each l.turns as t, i (i)}
          <line x1={x(t)} x2={x(t)} y1={y0 + 6} y2={y0 + 9} class="turn" />
        {/each}
        <!-- Tool-Aufrufe -->
        {#each l.spans as s, si (si)}
          {@const x0 = x(s.start)}
          {@const w = Math.max(3, x(spanEnd(s, l)) - x0)}
          <rect
            x={x0}
            y={y0 + 8}
            width={w}
            height={ROW - 16}
            rx="2"
            fill={s.isError ? 'var(--status-critical)' : toolColor(s.name)}
            opacity={s.end === undefined ? 0.55 : 1}
            class="span"
            role="presentation"
            onmousemove={(e) => (hover = { lane: l, span: s, x: e.clientX, y: e.clientY })}
            onclick={() => open(l, s)}
          />
        {/each}
      {/each}
    </svg>
  </div>
</div>

{#if hover}
  <div class="tip" style:left="{hover.x + 14}px" style:top="{hover.y + 12}px">
    {#if hover.span}
      {@const s = hover.span}
      <div><span class="swatch" style:background={s.isError ? 'var(--status-critical)' : toolColor(s.name)}></span> <strong class="mono">{splitMcpName(s.name).tool}</strong>{s.isError ? ' · ⚠ error' : ''}</div>
      <div>{s.summary}</div>
      <div class="faint">{time(s.start)} · {s.end !== undefined ? duration(s.end - s.start) : 'running'} · {hover.lane.label}</div>
    {/if}
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin: 4px 0 10px;
  }
  .legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--muted);
  }
  .legend > span {
    display: inline-flex;
    gap: 5px;
    align-items: center;
  }
  .swatch.err {
    background: var(--status-critical);
  }
  .controls {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .chk {
    display: flex;
    gap: 5px;
    align-items: center;
    font-size: 12.5px;
  }
  .tl {
    display: grid;
    grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
    overflow: hidden;
  }
  .labels {
    border-right: 1px solid var(--border);
    background: var(--surface);
  }
  .axis-space {
    height: 26px;
    border-bottom: 1px solid var(--border);
  }
  .lane-label {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 30px;
    padding-right: 8px;
    border: none;
    background: none;
    text-align: left;
    font-size: 12.5px;
    min-width: 0;
  }
  .lane-label:hover {
    background: var(--surface-2);
  }
  .lane-label.finished {
    background: var(--surface-2);
  }
  .lane-label.finished .ll-main {
    color: var(--faint);
  }
  .ll-main {
    font-weight: 600;
    flex: none;
    max-width: 60%;
  }
  .lane-label.spawn .ll-main {
    color: var(--info);
  }
  .lane-label.finished.spawn .ll-main {
    color: var(--faint);
  }
  .ll-sub {
    min-width: 0;
    font-size: 11.5px;
  }
  .scroller {
    overflow-x: auto;
  }
  svg {
    display: block;
  }
  .grid {
    stroke: var(--grid);
  }
  .tick {
    font-size: 10.5px;
    fill: var(--faint);
  }
  .gap {
    fill: var(--surface-2);
    opacity: 0.8;
  }
  .gap-label {
    font-style: italic;
  }
  .lane-bg {
    fill: color-mix(in srgb, var(--busy) 12%, transparent);
  }
  .lane-bg.finished {
    fill: var(--surface-2);
  }
  .link {
    stroke: var(--faint);
    stroke-width: 1;
  }
  .link.spawn {
    stroke: var(--info);
    stroke-dasharray: 3 3;
  }
  .link-dot {
    fill: var(--faint);
  }
  .link-dot.spawn {
    fill: var(--info);
  }
  .turn {
    stroke: var(--muted);
    stroke-width: 1;
    opacity: 0.5;
  }
  .span {
    cursor: pointer;
  }
  .span:hover {
    stroke: var(--text);
    stroke-width: 1.5;
  }
  @media (max-width: 640px) {
    .tl {
      grid-template-columns: minmax(96px, 38%) minmax(0, 1fr);
    }
    .ll-main {
      max-width: none;
      flex: 1;
      min-width: 0;
    }
    .ll-sub {
      display: none;
    }
    .controls {
      flex-wrap: wrap;
    }
  }
</style>
