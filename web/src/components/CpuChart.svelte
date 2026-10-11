<script lang="ts">
  import type { CpuHistory } from '$shared/types';
  import { duration } from '../lib/format';
  import { tipAt } from '../lib/tooltip';

  let { history }: { history: CpuHistory } = $props();

  // Farbe folgt dem Prozessnamen: einmal vergebene Plätze bleiben beim Nachladen erhalten.
  const slots = new Map<string, number>();
  function colorOf(key: string): string {
    if (key === 'other') return 'var(--series-other)';
    let i = slots.get(key);
    if (i === undefined) {
      const used = new Set(slots.values());
      i = [0, 1, 2, 3, 4, 5, 6, 7].find((n) => !used.has(n)) ?? 7;
      slots.set(key, i);
    }
    return `var(--series-${i + 1})`;
  }
  const keyColors = $derived(history.keys.map(colorOf));

  let width = $state(700);
  const height = 260;
  const pad = { top: 10, right: 10, bottom: 26, left: 48 };
  const plotW = $derived(Math.max(10, width - pad.left - pad.right));
  const plotH = height - pad.top - pad.bottom;

  const pts = $derived(history.points);
  const t0 = $derived(pts[0]?.t ?? 0);
  const t1 = $derived((pts[pts.length - 1]?.t ?? 0) + history.bucketMs);
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * plotW;
  const totals = $derived(pts.map((p) => (p.values ? p.values.reduce((a, b) => a + b, 0) : null)));

  // Skala mindestens bis 100 % (ein Kern), damit ruhige Sessions flach aussehen
  const niceMax = $derived.by(() => {
    const max = Math.max(100, ...totals.map((v) => v ?? 0));
    const mag = 10 ** Math.floor(Math.log10(max));
    // Viertel davon bleiben ganze Zahlen (25 %, 50 %, 150 % …)
    for (const m of [1, 2, 4, 6, 8, 10]) if (m * mag >= max) return m * mag;
    return 10 * mag;
  });
  const y = (v: number) => plotH - (v / niceMax) * plotH;
  const yTicks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax));

  const sameDay = $derived(new Date(t0).toDateString() === new Date(t1).toDateString());
  // kurze Zeiträume mit Sekunden, sonst wiederholen sich die Achsenbeschriftungen
  const short = $derived(t1 - t0 < 20 * 60_000);
  const fmtTime = (t: number, withDate = !sameDay) =>
    new Date(t).toLocaleString(
      'en-GB',
      withDate ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: short ? '2-digit' : undefined },
    );
  const xTicks = $derived.by(() => {
    const n = Math.max(2, Math.floor(plotW / (!sameDay ? 110 : short ? 80 : 70)));
    return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
  });

  /** Je Reihe ein Flächenpfad, aufgeteilt an Messlücken. Punkte sitzen in der Mitte ihres Abschnitts. */
  const areas = $derived.by(() => {
    const out = history.keys.map(() => '');
    let run: { cx: number; stack: number[] }[] = [];
    const flush = () => {
      if (run.length === 0) return;
      // einzelner Punkt: als schmaler Streifen über seinen Abschnitt
      const r =
        run.length === 1
          ? [
              { cx: run[0].cx - (x(t0 + history.bucketMs) - x(t0)) / 2, stack: run[0].stack },
              { cx: run[0].cx + (x(t0 + history.bucketMs) - x(t0)) / 2, stack: run[0].stack },
            ]
          : run;
      for (let k = 0; k < history.keys.length; k++) {
        const top = r.map((p, i) => `${i ? 'L' : 'M'}${p.cx.toFixed(1)},${y(p.stack[k + 1]).toFixed(1)}`).join(' ');
        const bottom = [...r].reverse().map((p) => `L${p.cx.toFixed(1)},${y(p.stack[k]).toFixed(1)}`).join(' ');
        out[k] += `${top} ${bottom} Z `;
      }
      run = [];
    };
    for (const p of pts) {
      if (!p.values) {
        flush();
        continue;
      }
      const stack = [0];
      for (const v of p.values) stack.push(stack[stack.length - 1] + v);
      run.push({ cx: x(p.t + history.bucketMs / 2), stack });
    }
    flush();
    return out;
  });

  let hover = $state<{ i: number; cx: number; x: number; y: number } | null>(null);
  function onMove(e: MouseEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - r.left - pad.left;
    if (px < 0 || px > plotW || pts.length === 0) return (hover = null);
    const i = Math.min(pts.length - 1, Math.max(0, Math.floor(((px / plotW) * (t1 - t0)) / history.bucketMs)));
    hover = { i, cx: x(pts[i].t + history.bucketMs / 2), x: e.clientX, y: e.clientY };
  }

  const pct = (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
  const cpuTime = (s: number) => (s < 1 ? `${s.toFixed(1)}s` : duration(s * 1000));
</script>

<div class="cpu-chart">
  <div class="summary">
    <div><span class="label">CPU time</span><span class="value">{cpuTime(history.cpuSeconds)}</span></div>
    <div><span class="label">Peak</span><span class="value">{pct(history.peak)}</span></div>
    <div><span class="label">Range</span><span class="value small">{fmtTime(t0, true)} – {fmtTime(t1, true)}</span></div>
    <div class="note faint">claude process + all subprocesses · 100% = one core · {history.cores} cores</div>
  </div>

  <div class="legend">
    {#each history.keys as k, i (k)}<span><span class="swatch" style:background={keyColors[i]}></span>{k}</span>{/each}
  </div>

  <div class="plot" bind:clientWidth={width}>
    <svg {width} {height} role="img" aria-label="CPU usage over time by process" onmousemove={onMove} onmouseleave={() => (hover = null)}>
      <g transform="translate({pad.left},{pad.top})">
        {#each yTicks as t (t)}
          <line x1="0" x2={plotW} y1={y(t)} y2={y(t)} class="grid" />
          <text x="-8" y={y(t)} class="tick" text-anchor="end" dominant-baseline="middle">{pct(t)}</text>
        {/each}
        {#each areas as d, k (history.keys[k])}
          <path {d} fill={keyColors[k]} opacity="0.85" />
        {/each}
        {#each xTicks as t, i (i)}
          <text x={x(t)} y={plotH + 17} class="tick" text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{fmtTime(t)}</text>
        {/each}
        <line x1="0" x2={plotW} y1={plotH} y2={plotH} class="axis" />
        {#if hover}
          <line x1={hover.cx} x2={hover.cx} y1="0" y2={plotH} class="cross" />
        {/if}
      </g>
    </svg>
    {#if hover}
      {@const p = pts[hover.i]}
      <div class="tip" use:tipAt={{ x: hover.x, y: hover.y }}>
        <div class="tip-title">{fmtTime(p.t, true)}{history.bucketMs > 5000 ? ` · Ø ${duration(history.bucketMs)}` : ''}</div>
        {#if p.values}
          <div class="tip-row total"><span>Total</span><span class="num">{pct(totals[hover.i] ?? 0)}</span></div>
          {#each history.keys as k, i (k)}
            {#if p.values[i] > 0}
              <div class="tip-row">
                <span class="swatch" style:background={keyColors[i]}></span>
                <span>{k}</span>
                <span class="num">{pct(p.values[i])}</span>
              </div>
            {/if}
          {/each}
        {:else}
          <div class="faint">not measured (claude-inspect wasn't running)</div>
        {/if}
      </div>
    {/if}
  </div>

  <h3>Processes</h3>
  <table class="list">
    <thead><tr><th>Process</th><th class="num">CPU time</th><th class="num">Peak</th><th class="num">PIDs</th></tr></thead>
    <tbody>
      {#each history.processes.slice(0, 20) as p (p.comm)}
        {@const i = history.keys.indexOf(p.comm)}
        <tr>
          <td><span class="swatch" style:background={i >= 0 ? keyColors[i] : 'var(--series-other)'}></span> <span class="mono">{p.comm}</span></td>
          <td class="num">{cpuTime(p.cpuSeconds)}</td>
          <td class="num">{pct(p.peak)}</td>
          <td class="num">{p.pids}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if history.file}<p class="faint small mono file">{history.file}</p>{/if}
</div>

<style>
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 26px;
    margin-bottom: 10px;
  }
  .summary > div:not(.note) {
    display: flex;
    flex-direction: column;
  }
  .label {
    font-size: 12px;
    color: var(--muted);
  }
  .value {
    font-size: 20px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .value.small {
    font-size: 14px;
    font-weight: 500;
  }
  .note {
    font-size: 12px;
    margin-left: auto;
  }
  .legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 12.5px;
    color: var(--muted);
    margin: 4px 0 10px;
  }
  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .plot {
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
  .cross {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
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
  .tip-row.total {
    font-weight: 600;
  }
  .tip-row .num {
    margin-left: auto;
    padding-left: 14px;
  }
  h3 {
    margin: 22px 0 8px;
    font-size: 14px;
  }
  .file {
    margin-top: 10px;
    word-break: break-all;
  }
  .small {
    font-size: 12px;
  }
</style>
