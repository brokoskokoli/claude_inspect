<script lang="ts">
  import type { FormatReport } from '$shared/types';
  import { api } from '../lib/api';

  let report = $state<FormatReport | null>(null);
  let error = $state('');
  api.formats().then((r) => (report = r)).catch((e) => (error = String(e)));

  const bySource = $derived.by(() => {
    const m = new Map<string, FormatReport['decoders']>();
    for (const d of report?.decoders ?? []) m.set(d.source, [...(m.get(d.source) ?? []), d]);
    return [...m.entries()];
  });
</script>

<div class="intro">
  <h2>Formats & schema drift</h2>
  <p class="muted">
    Every record is detected individually: all decoders of a source score it and the highest score wins. Unknown records
    end up in the fallback and are shown raw. Below are fields no decoder knows yet – they appear in the UI as “more
    fields” and are candidates for a new or extended decoder (see <code>docs/FORMATS.md</code>). Numbers cover everything
    read since the server started.
  </p>
</div>

{#if error}<p class="badge error">{error}</p>{/if}

{#if report}
  <section>
    <h3>Decoders</h3>
    <div class="card table-scroll">
      <table class="list">
        <thead><tr><th>Source</th><th>Id</th><th>Versions</th><th>Description</th><th class="num">Hits</th></tr></thead>
        <tbody>
          {#each bySource as [source, decoders] (source)}
            {#each decoders as d, i (d.id)}
              <tr>
                <td class="muted">{i === 0 ? source : ''}</td>
                <td class="mono">{d.id}</td>
                <td class="mono muted">{d.versions ?? '*'}</td>
                <td>{d.description}</td>
                <td class="num" class:faint={!d.hits}>{d.hits}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h3>Unknown fields <span class="muted">({report.drift.length})</span></h3>
    {#if report.drift.length === 0}
      <p class="muted">None – every record read so far is fully understood.</p>
    {:else}
      <div class="card table-scroll">
        <table class="list">
          <thead><tr><th>Source</th><th>Record type</th><th>Field</th><th>Versions</th><th class="num">Count</th></tr></thead>
          <tbody>
            {#each report.drift as x (x.source + x.recordType + x.field)}
              <tr>
                <td class="muted">{x.source}</td>
                <td class="mono">{x.recordType}</td>
                <td class="mono" class:warn={x.field.startsWith('(')}>{x.field}</td>
                <td class="mono muted">{x.firstVersion ?? '?'}{x.lastVersion && x.lastVersion !== x.firstVersion ? ` – ${x.lastVersion}` : ''}</td>
                <td class="num">{x.count}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

<style>
  .intro {
    max-width: 820px;
    margin-bottom: 20px;
  }
  .intro p {
    margin: 6px 0 0;
  }
  section {
    margin-bottom: 26px;
  }
  h3 {
    font-size: 14px;
    margin-bottom: 8px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .warn {
    color: var(--error);
  }
  /* phones: tables scroll inside their card; keep the description readable */
  @media (max-width: 640px) {
    td:nth-child(4) {
      min-width: 200px;
    }
    td.mono {
      white-space: nowrap;
    }
  }
</style>
