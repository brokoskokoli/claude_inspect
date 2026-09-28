<script lang="ts">
  import type { ToolCallRow } from '$shared/types';
  import { splitMcpName } from '$shared/tools';
  import HistoryFilters from '../components/HistoryFilters.svelte';
  import { api, type HistoryFilter } from '../lib/api';
  import { toolColor } from '../lib/colors';
  import { dateTime, duration, shortPath } from '../lib/format';
  import { href } from '../lib/router.svelte';

  import { untrack } from 'svelte';

  let { params: routeParams }: { params: URLSearchParams } = $props();
  // Die Seite wird bei geänderter URL neu erzeugt (App: {#key}); Startwerte genügen.
  const params = untrack(() => routeParams);

  const PAGE = 100;
  let filter = $state<HistoryFilter>({ days: params.get('days') ? Number(params.get('days')) : undefined, project: params.get('project') ?? undefined });
  let name = $state(params.get('name') ?? '');
  let q = $state(params.get('q') ?? '');
  let errors = $state(params.get('errors') === '1');
  const file = params.get('file') ?? undefined;
  const session = params.get('session') ?? undefined;

  let rows = $state.raw<ToolCallRow[]>([]);
  let names = $state<string[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load(reset: boolean) {
    loading = true;
    try {
      const r = await api.tools({ ...filter, name: name || undefined, q: q || undefined, errors, file, session, offset: reset ? 0 : rows.length, limit: PAGE });
      rows = reset ? r.rows : [...rows, ...r.rows];
      total = r.total;
      names = r.names;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void [filter.days, filter.project, name, q, errors];
    clearTimeout(timer);
    timer = setTimeout(() => load(true), 200);
  });
</script>

<div class="page-head">
  <h2>Tool-Aufrufe</h2>
  <span class="muted">{total.toLocaleString('de-DE')} Treffer</span>
  {#if file}<span class="badge info" title={file}>Datei: {shortPath(file)}</span>{/if}
  {#if session}<span class="badge info">Session {session.slice(0, 8)}</span>{/if}
</div>
<div class="filters bar">
  <HistoryFilters bind:filter />
  <select bind:value={name} aria-label="Tool">
    <option value="">Alle Tools</option>
    {#each names as n (n)}<option value={n}>{n}</option>{/each}
  </select>
  <label class="chk"><input type="checkbox" bind:checked={errors} /> nur Fehler/Abgelehnt</label>
  <input type="search" placeholder="Befehl, Datei, Beschreibung …" bind:value={q} />
</div>

<div class="card">
  <table class="list">
    <thead><tr><th>Zeit</th><th>Tool</th><th>Aufruf</th><th>Projekt</th><th class="num">Dauer</th><th></th></tr></thead>
    <tbody>
      {#each rows as r, i (i)}
        {@const mcp = splitMcpName(r.name)}
        <tr class="clickable" onclick={() => (location.hash = href.session(r.sessionId, r.agentId, { tool: r.toolUseId }))}>
          <td class="nowrap muted">{dateTime(r.ts)}</td>
          <td class="nowrap"><span class="swatch" style:background={toolColor(r.name)}></span> <span class="mono">{mcp.tool}</span>{#if mcp.server}<span class="faint small"> {mcp.server}</span>{/if}</td>
          <td class="sum"><div class="ellipsis">{r.summary}</div>{#if r.file}<div class="ellipsis faint small mono">{shortPath(r.file)}</div>{/if}</td>
          <td class="nowrap muted">{r.project}{r.agentId ? ' · Subagent' : ''}</td>
          <td class="num nowrap">{r.durationMs !== undefined ? duration(r.durationMs) : '–'}</td>
          <td class="nowrap">{#if r.denied}<span class="badge error">abgelehnt</span>{:else if r.isError}<span class="badge error">Fehler</span>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
{#if rows.length < total}
  <div class="more"><button class="btn" disabled={loading} onclick={() => load(false)}>{loading ? 'Lade …' : `Weitere laden (${(total - rows.length).toLocaleString('de-DE')})`}</button></div>
{/if}

<style>
  .bar {
    margin-bottom: 12px;
  }
  .bar input[type='search'] {
    margin-left: auto;
    width: min(320px, 100%);
  }
  .chk {
    display: flex;
    gap: 5px;
    align-items: center;
    font-size: 13px;
  }
  .sum {
    max-width: 0;
    width: 60%;
  }
  .nowrap {
    white-space: nowrap;
  }
  .small {
    font-size: 11.5px;
  }
  .more {
    text-align: center;
    margin-top: 14px;
  }
</style>
