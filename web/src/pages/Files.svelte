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
          <td class="muted nowrap proj">{f.project}</td>
          <td class="num cnt" data-label="Edits">{f.edits || ''}</td>
          <td class="num cnt" data-label="Writes">{f.writes || ''}</td>
          <td class="num muted cnt" data-label="Reads">{f.reads || ''}</td>
          <td class="num cnt" data-label="Sessions">{f.sessions}</td>
          <td class="muted nowrap last">{ago(f.lastTs, clock.now)}</td>
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
  /* phones: path on its own line (wrapping), counts with labels below */
  @media (max-width: 640px) {
    thead {
      display: none;
    }
    table,
    tbody {
      display: block;
    }
    tr {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 14px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    tr:last-child {
      border-bottom: none;
    }
    table.list td {
      display: block;
      padding: 0;
      border: none;
    }
    .path {
      flex: 1 1 100%;
      max-width: none;
      width: auto;
    }
    .path .ellipsis {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .proj {
      order: 1;
      flex: 1 1 60%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .last {
      order: 2;
      text-align: right;
    }
    .cnt {
      order: 3;
      font-size: 13px;
    }
    .cnt:empty {
      display: none;
    }
    .cnt::before {
      content: attr(data-label) ' ';
      color: var(--faint);
    }
  }
  .center {
    text-align: center;
  }
</style>
