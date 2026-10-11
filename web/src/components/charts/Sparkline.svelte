<script lang="ts">
  /** Kleiner Verlauf ohne Achsen. `min` hält die Skala unten fest, damit ruhige Phasen flach aussehen. */
  let { values, min = 100, width = 72, height = 18, ariaLabel }: { values: number[]; min?: number; width?: number; height?: number; ariaLabel: string } = $props();

  const max = $derived(Math.max(min, ...values));
  const path = $derived.by(() => {
    if (values.length < 2) return { line: '', area: '' };
    const step = width / (values.length - 1);
    const pts = values.map((v, i) => [i * step, height - 1 - (v / max) * (height - 2)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L${width},${height} L0,${height} Z` };
  });
</script>

<svg {width} {height} role="img" aria-label={ariaLabel}>
  <path d={path.area} class="area" />
  <path d={path.line} class="line" />
</svg>

<style>
  svg {
    display: inline-block;
    vertical-align: middle;
    overflow: visible;
  }
  .area {
    fill: color-mix(in srgb, var(--series-1) 18%, transparent);
  }
  .line {
    fill: none;
    stroke: var(--series-1);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
</style>
