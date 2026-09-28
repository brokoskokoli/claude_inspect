<script lang="ts">
  let { grid, rowLabels, colLabels, unit }: { grid: number[][]; rowLabels: string[]; colLabels: string[]; unit: string } = $props();

  let hover = $state<{ r: number; c: number; x: number; y: number } | null>(null);
  const max = $derived(Math.max(1, ...grid.flat()));
  // 8-stufige sequentielle Skala (eine Farbe, hell → dunkel); 0 = Fläche
  const step = (v: number) => (v <= 0 ? 0 : Math.min(7, 1 + Math.floor((Math.sqrt(v / max) * 7) - 1e-9)));
</script>

<div class="heat" role="img" aria-label="Aktivität nach Wochentag und Uhrzeit">
  <div class="corner"></div>
  {#each colLabels as c, i (i)}<div class="col-label">{i % 3 === 0 ? c : ''}</div>{/each}
  {#each grid as row, r (r)}
    <div class="row-label">{rowLabels[r]}</div>
    {#each row as v, c (c)}
      <div
        class="cell"
        style:background="var(--seq-{step(v)})"
        role="presentation"
        onmousemove={(e) => (hover = { r, c, x: e.clientX, y: e.clientY })}
        onmouseleave={() => (hover = null)}
      ></div>
    {/each}
  {/each}
</div>
<div class="scale faint">
  weniger {#each [0, 1, 2, 3, 4, 5, 6, 7] as s (s)}<span class="swatch" style:background="var(--seq-{s})"></span>{/each} mehr
</div>
{#if hover}
  <div class="tip" style:left="{hover.x + 14}px" style:top="{hover.y + 10}px">
    <strong>{rowLabels[hover.r]}, {colLabels[hover.c]}–{hover.c + 1} Uhr</strong><br />
    {grid[hover.r][hover.c].toLocaleString('de-DE')} {unit}
  </div>
{/if}

<style>
  .heat {
    display: grid;
    grid-template-columns: 28px repeat(24, minmax(0, 1fr));
    gap: 2px;
    font-size: 11px;
  }
  .col-label,
  .row-label {
    color: var(--faint);
  }
  .col-label {
    text-align: left;
  }
  .row-label {
    align-self: center;
  }
  .cell {
    aspect-ratio: 1.3;
    border-radius: 3px;
  }
  .cell:hover {
    outline: 2px solid var(--text);
    outline-offset: -1px;
  }
  .scale {
    display: flex;
    align-items: center;
    gap: 3px;
    justify-content: flex-end;
    font-size: 11px;
    margin-top: 6px;
  }
</style>
