<script lang="ts">
  import type { HistoryStats } from '$shared/types';
  import StackedColumns from '../components/charts/StackedColumns.svelte';
  import Heatmap from '../components/charts/Heatmap.svelte';
  import HistoryFilters from '../components/HistoryFilters.svelte';
  import { api, type HistoryFilter } from '../lib/api';
  import { modelColor } from '../lib/colors';
  import { ago, duration, modelName, tokens, usd } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';

  let filter = $state<HistoryFilter>({ days: 30 });
  let stats = $state<HistoryStats | null>(null);
  let error = $state('');
  let metric = $state<'cost' | 'output'>('cost');
  let retry: ReturnType<typeof setTimeout> | undefined;

  async function load(f: HistoryFilter) {
    clearTimeout(retry);
    try {
      stats = await api.stats(f);
      error = '';
      // Erster Scan läuft noch im Hintergrund → nachladen
      if (!stats.ready) retry = setTimeout(() => load(f), 1500);
    } catch (e) {
      error = String(e);
    }
  }
  $effect(() => {
    void load({ ...filter });
    return () => clearTimeout(retry);
  });

  const modelKeys = $derived(stats?.byModel.map((m) => m.model) ?? []);
  const columns = $derived(
    (stats?.byDay ?? []).map((d) => ({
      label: d.day.slice(8, 10) + '.' + d.day.slice(5, 7) + '.',
      segments: Object.entries(d.byModel).map(([key, v]) => ({ key, value: metric === 'cost' ? v.costUSD : v.output })),
    })),
  );
  const fmt = (v: number) => (metric === 'cost' ? (v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(v < 10 ? 2 : 0)}`) : tokens(Math.round(v)));
  const cacheShare = $derived.by(() => {
    const t = stats?.totals.tokens;
    if (!t) return 0;
    const all = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
    return all ? t.cacheRead / all : 0;
  });
</script>

<div class="page-head">
  <h2>Statistik</h2>
  <HistoryFilters bind:filter />
  {#if stats && !stats.ready}<span class="faint">Scan läuft … {stats.scannedFiles} Dateien</span>{/if}
</div>

{#if error}<p class="badge error">{error}</p>{/if}

{#if stats}
  <section class="tiles">
    <div class="card tile">
      <div class="label">API-Gegenwert (Schätzung)</div>
      <div class="value">{usd(stats.totals.costUSD)}</div>
      <div class="sub faint">nach Listenpreisen; bei Abo nicht direkt bezahlt</div>
    </div>
    <div class="card tile">
      <div class="label">Output-Tokens</div>
      <div class="value">{tokens(stats.totals.tokens.output)}</div>
      <div class="sub faint">{stats.totals.tokens.requests.toLocaleString('de-DE')} Modell-Anfragen</div>
    </div>
    <div class="card tile">
      <div class="label">Cache-Anteil Input</div>
      <div class="value">{(cacheShare * 100).toFixed(1)} %</div>
      <div class="sub faint">{tokens(stats.totals.tokens.cacheRead)} aus dem Cache gelesen</div>
    </div>
    <div class="card tile">
      <div class="label">Tool-Aufrufe</div>
      <div class="value">{stats.totals.toolCalls.toLocaleString('de-DE')}</div>
      <div class="sub faint">{stats.totals.prompts.toLocaleString('de-DE')} Prompts · {stats.totals.sessions} Sessions</div>
    </div>
  </section>

  <section class="card block">
    <div class="block-head">
      <h3>{metric === 'cost' ? 'API-Gegenwert' : 'Output-Tokens'} pro Tag nach Modell</h3>
      <div class="seg">
        <button class:on={metric === 'cost'} onclick={() => (metric = 'cost')}>Kosten</button>
        <button class:on={metric === 'output'} onclick={() => (metric = 'output')}>Output-Tokens</button>
      </div>
    </div>
    <div class="legend">
      {#each modelKeys as m (m)}<span><span class="swatch" style:background={modelColor(m)}></span>{modelName(m)}</span>{/each}
    </div>
    {#if columns.length}
      <StackedColumns {columns} keys={modelKeys} colorOf={modelColor} labelOf={modelName} format={fmt} ariaLabel="Verlauf pro Tag nach Modell" />
    {:else}
      <p class="muted">Keine Daten im Zeitraum.</p>
    {/if}
  </section>

  <div class="two">
    <section class="card block">
      <h3>Aktivität nach Wochentag und Uhrzeit</h3>
      <p class="faint small">Modell-Antworten, Ortszeit</p>
      <Heatmap grid={stats.heat} rowLabels={['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']} colLabels={Array.from({ length: 24 }, (_, i) => String(i))} unit="Antworten" />
    </section>

    <section class="card block">
      <h3>Modelle</h3>
      <table class="list">
        <thead><tr><th>Modell</th><th class="num">Anfragen</th><th class="num">Output</th><th class="num">Cache gelesen</th><th class="num">Cache geschrieben</th><th class="num">Kosten</th></tr></thead>
        <tbody>
          {#each stats.byModel as m (m.model)}
            <tr>
              <td><span class="swatch" style:background={modelColor(m.model)}></span> {modelName(m.model)}</td>
              <td class="num">{m.tokens.requests.toLocaleString('de-DE')}</td>
              <td class="num">{tokens(m.tokens.output)}</td>
              <td class="num">{tokens(m.tokens.cacheRead)}</td>
              <td class="num">{tokens(m.tokens.cacheWrite5m + m.tokens.cacheWrite1h)}</td>
              <td class="num">{m.costUSD === undefined ? 'unbekannt' : usd(m.costUSD)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>

  <div class="two">
    <section class="card block">
      <h3>Projekte</h3>
      <table class="list">
        <thead><tr><th>Projekt</th><th class="num">Sessions</th><th class="num">Tools</th><th class="num">Output</th><th class="num">Kosten</th><th>Zuletzt</th></tr></thead>
        <tbody>
          {#each stats.byProject as p (p.project)}
            <tr class="clickable" onclick={() => (filter = { ...filter, project: p.project })}>
              <td>{p.project}</td>
              <td class="num">{p.sessions}</td>
              <td class="num">{p.toolCalls.toLocaleString('de-DE')}</td>
              <td class="num">{tokens(p.outputTokens)}</td>
              <td class="num">{usd(p.costUSD)}</td>
              <td class="muted">{ago(p.lastActivity, clock.now)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section class="card block">
      <h3>Tools</h3>
      <table class="list">
        <thead><tr><th>Tool</th><th class="num">Aufrufe</th><th class="num">Fehler</th><th class="num">Ø Dauer</th><th class="num">p95</th></tr></thead>
        <tbody>
          {#each stats.tools.slice(0, 20) as t (t.name)}
            <tr class="clickable" onclick={() => (location.hash = href.tools({ name: t.name, project: filter.project, days: filter.days ? String(filter.days) : undefined }))}>
              <td class="mono">{t.name}</td>
              <td class="num">{t.count.toLocaleString('de-DE')}</td>
              <td class="num" class:err={t.errors > 0}>{t.errors || ''}{t.denied ? ` (+${t.denied} abgelehnt)` : ''}</td>
              <td class="num">{t.avgMs !== undefined ? duration(t.avgMs) : '–'}</td>
              <td class="num">{t.p95Ms !== undefined ? duration(t.p95Ms) : '–'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>
{:else if !error}
  <p class="muted">Lade …</p>
{/if}

<style>
  section {
    margin-bottom: 16px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
  }
  .tile {
    padding: 14px 16px;
  }
  .label {
    font-size: 12.5px;
    color: var(--muted);
  }
  .value {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin: 2px 0;
  }
  .sub {
    font-size: 12px;
  }
  .block {
    padding: 14px 16px;
    overflow-x: auto;
  }
  .block h3 {
    font-size: 14px;
    margin-bottom: 8px;
  }
  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
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
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(520px, 100%), 1fr));
    gap: 16px;
  }
  .two section {
    margin-bottom: 0;
  }
  .two {
    margin-bottom: 16px;
  }
  .small {
    font-size: 12px;
    margin: -4px 0 8px;
  }
  .err {
    color: var(--error);
  }
</style>
