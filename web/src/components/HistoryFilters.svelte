<script lang="ts">
  import { api, type HistoryFilter } from '../lib/api';

  let { filter = $bindable() }: { filter: HistoryFilter } = $props();

  const RANGES: [string, number | undefined][] = [
    ['7 days', 7],
    ['30 days', 30],
    ['90 days', 90],
    ['All', undefined],
  ];
  let projects = $state<string[]>([]);
  api.projects().then((p) => (projects = p));
</script>

<div class="filters">
  <div class="seg" role="group" aria-label="Time range">
    {#each RANGES as [label, days] (label)}
      <button class:on={filter.days === days} onclick={() => (filter = { ...filter, days })}>{label}</button>
    {/each}
  </div>
  <select value={filter.project ?? ''} onchange={(e) => (filter = { ...filter, project: e.currentTarget.value || undefined })} aria-label="Project">
    <option value="">All projects</option>
    {#each projects as p (p)}<option value={p}>{p}</option>{/each}
  </select>
</div>
