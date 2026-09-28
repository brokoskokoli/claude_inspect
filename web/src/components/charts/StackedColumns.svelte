<script lang="ts">
  export interface Column {
    label: string;
    segments: { key: string; value: number }[];
  }

  let {
    columns,
    keys,
    colorOf,
    labelOf = (k: string) => k,
    format,
    height = 220,
    ariaLabel,
  }: {
    columns: Column[];
    keys: string[];
    colorOf: (key: string) => string;
    labelOf?: (key: string) => string;
    format: (v: number) => string;
    height?: number;
    ariaLabel: string;
  } = $props();

  let width = $state(600);
  let hover = $state<{ i: number; x: number; y: number } | null>(null);

  const pad = { top: 10, right: 8, bottom: 26, left: 52 };
  const plotW = $derived(Math.max(10, width - pad.left - pad.right));
  const plotH = $derived(height - pad.top - pad.bottom);

  const totals = $derived(columns.map((c) => c.segments.reduce((s, x) => s + x.value, 0)));
  // saubere Achsenteilung
  const niceMax = $derived.by(() => {
    const max = Math.max(0, ...totals);
    if (max <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(max));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= max) return m * mag;
    return 10 * mag;
  });
  const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax));
  const band = $derived(plotW / Math.max(1, columns.length));
  const barW = $derived(Math.max(2, Math.min(24, band * 0.7)));
  const y = (v: number) => plotH - (v / niceMax) * plotH;
  const labelEvery = $derived(Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor(plotW / 56)))));

  function topPath(x: number, y0: number, w: number, h: number): string {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y0 + h} V${y0 + r} Q${x},${y0} ${x + r},${y0} H${x + w - r} Q${x + w},${y0} ${x + w},${y0 + r} V${y0 + h} Z`;
  }

  const stacks = $derived(
    columns.map((c, i) => {
      const x = i * band + (band - barW) / 2;
      let acc = 0;
      const ordered = keys.map((k) => ({ key: k, value: c.segments.find((s) => s.key === k)?.value ?? 0 })).filter((s) => s.value > 0);
      const segs = ordered.map((s, j) => {
        const y1 = y(acc);
        acc += s.value;
        const y0 = y(acc);
        const gap = j < ordered.length - 1 ? 2 : 0; // 2px Oberflächen-Lücke zwischen Segmenten
        return { ...s, x, y0: y0 + gap, h: Math.max(0, y1 - y0 - gap), top: j === ordered.length - 1 };
      });
      return { x, segs };
    }),
  );
</script>

<div class="chart" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label={ariaLabel} onmouseleave={() => (hover = null)}>
    <g transform="translate({pad.left},{pad.top})">
      {#each ticks as t (t)}
        <line x1="0" x2={plotW} y1={y(t)} y2={y(t)} class="grid" />
        <text x="-8" y={y(t)} class="tick" text-anchor="end" dominant-baseline="middle">{format(t)}</text>
      {/each}
      {#each stacks as s, i (i)}
        <!-- Trefferfläche: ganze Spalte -->
        <rect
          x={i * band}
          y="0"
          width={band}
          height={plotH}
          fill="transparent"
          role="presentation"
          onmousemove={(e) => (hover = { i, x: e.clientX, y: e.clientY })}
        />
        {#each s.segs as seg (seg.key)}
          {#if seg.top}
            <path d={topPath(seg.x, seg.y0, barW, seg.h)} fill={colorOf(seg.key)} opacity={hover && hover.i !== i ? 0.45 : 1} pointer-events="none" />
          {:else}
            <rect x={seg.x} y={seg.y0} width={barW} height={seg.h} fill={colorOf(seg.key)} opacity={hover && hover.i !== i ? 0.45 : 1} pointer-events="none" />
          {/if}
        {/each}
        {#if i % labelEvery === 0}
          <text x={i * band + band / 2} y={plotH + 17} class="tick" text-anchor="middle">{columns[i].label}</text>
        {/if}
      {/each}
      <line x1="0" x2={plotW} y1={plotH} y2={plotH} class="axis" />
    </g>
  </svg>
  {#if hover}
    {@const c = columns[hover.i]}
    <div class="tip" style:left="{hover.x + 14}px" style:top="{hover.y + 10}px">
      <div class="tip-title">{c.label} · {format(totals[hover.i])}</div>
      {#each keys.filter((k) => c.segments.some((s) => s.key === k && s.value > 0)) as k (k)}
        <div class="tip-row">
          <span class="swatch" style:background={colorOf(k)}></span>
          <span>{labelOf(k)}</span>
          <span class="num">{format(c.segments.find((s) => s.key === k)!.value)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chart {
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--grid);
    stroke-width: 1;
  }
  .axis {
    stroke: var(--border);
    stroke-width: 1;
  }
  .tick {
    font-size: 11px;
    fill: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .tip-title {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .tip-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .tip-row .num {
    margin-left: auto;
    padding-left: 14px;
  }
</style>
