<script lang="ts">
  import type { FileStat } from '$shared/types';
  import HistoryFilters from '../components/HistoryFilters.svelte';
  import { api, type HistoryFilter } from '../lib/api';
  import { ago, shortPath } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';

  let filter = $state<HistoryFilter>({ days: 30 });
  let q = $state('');
  let files = $state.raw<FileStat[]>([]);
  let total = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const f = { ...filter, q: q || undefined };
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const r = await api.files(f);
      files = r.files;
      total = r.total;
    }, 200);
  });
</script>

<div class="page-head">
  <h2>Files</h2>
  <span class="muted">{total.toLocaleString('en-US')} files read or changed by agents</span>
</div>
<div class="filters bar">
  <HistoryFilters bind:filter />
  <input type="search" placeholder="Filter by path …" bind:value={q} />
</div>

<div class="card">
  <table class="list">
    <thead><tr><th>File</th><th>Project</th><th class="num">Edits</th><th class="num">Writes</th><th class="num">Reads</th><th class="num">Sessions</th><th>Last</th></tr></thead>
    <tbody>
      {#each files as f (f.path)}
        <tr class="clickable" onclick={() => (location.hash = href.tools({ file: f.path, days: filter.days ? String(filter.days) : undefined }))}>
          <td class="path"><div class="ellipsis mono" title={f.path}>{shortPath(f.path)}</div></td>
          <td class="muted nowrap">{f.project}</td>
          <td class="num">{f.edits || ''}</td>
          <td class="num">{f.writes || ''}</td>
          <td class="num muted">{f.reads || ''}</td>
          <td class="num">{f.sessions}</td>
          <td class="muted nowrap">{ago(f.lastTs, clock.now)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
{#if total > files.length}<p class="faint center">Showing the first {files.length} – use the filter.</p>{/if}

<style>
  .bar {
    margin-bottom: 12px;
  }
  .bar input[type='search'] {
    margin-left: auto;
    width: min(320px, 100%);
  }
  .path {
    max-width: 0;
    width: 55%;
  }
  .nowrap {
    white-space: nowrap;
  }
  .center {
    text-align: center;
  }
</style>
