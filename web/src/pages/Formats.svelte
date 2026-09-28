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
  <h2>Formate & Schema-Drift</h2>
  <p class="muted">
    Jeder Record wird einzeln erkannt: Alle Decoder einer Quelle bewerten ihn, der mit dem höchsten Score gewinnt. Unbekannte
    Records landen beim Fallback und werden roh angezeigt. Unten stehen Felder, die kein Decoder kennt. Sie erscheinen in der
    Oberfläche unter „weitere Felder“ und sind Kandidaten für einen neuen oder erweiterten Decoder (siehe
    <code>docs/FORMATS.md</code>). Die Zahlen beziehen sich auf alles, was seit dem Serverstart gelesen wurde.
  </p>
</div>

{#if error}<p class="badge error">{error}</p>{/if}

{#if report}
  <section>
    <h3>Decoder</h3>
    <div class="card">
      <table class="list">
        <thead><tr><th>Quelle</th><th>Id</th><th>Versionen</th><th>Beschreibung</th><th class="num">Treffer</th></tr></thead>
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
    <h3>Unbekannte Felder <span class="muted">({report.drift.length})</span></h3>
    {#if report.drift.length === 0}
      <p class="muted">Keine – alle gelesenen Records werden vollständig verstanden.</p>
    {:else}
      <div class="card">
        <table class="list">
          <thead><tr><th>Quelle</th><th>Record-Typ</th><th>Feld</th><th>Versionen</th><th class="num">Anzahl</th></tr></thead>
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
</style>
