<script lang="ts">
  import ProcessCard from '../components/ProcessCard.svelte';
  import SessionTable from '../components/SessionTable.svelte';
  import { ago, shortPath } from '../lib/format';
  import { clock, live } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';

  const d = $derived(live.dashboard);
  // Per claude-Aufruf gestartete Sitzungen direkt hinter ihren Aufrufer sortieren.
  const alive = $derived.by(() => {
    const list = d?.processes.filter((p) => p.process.alive) ?? [];
    const bySession = new Map(list.map((p) => [p.process.sessionId, p]));
    const childrenOf = new Map<string, typeof list>();
    const roots: typeof list = [];
    for (const p of list) {
      const parent = p.spawnedBy?.parentSessionId;
      if (parent && bySession.has(parent)) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), p]);
      else roots.push(p);
    }
    const out: typeof list = [];
    const visit = (p: (typeof list)[number]) => {
      out.push(p);
      for (const c of childrenOf.get(p.process.sessionId) ?? []) visit(c);
    };
    roots.forEach(visit);
    return out;
  });
  const dead = $derived(d?.processes.filter((p) => !p.process.alive) ?? []);
  const busy = $derived(alive.filter((p) => p.process.status !== 'idle').length);
</script>

{#if !d}
  <p class="muted">Lade …</p>
{:else}
  <section>
    <div class="section-head">
      <h2>Laufende Agenten</h2>
      <span class="muted">{alive.length} Prozesse · {busy} arbeiten</span>
      <span class="faint src">liest {shortPath(d.claudeDir)}</span>
    </div>
    {#if alive.length === 0}
      <div class="card empty muted">Gerade läuft kein Claude-Code-Prozess.</div>
    {:else}
      <div class="grid">
        {#each alive as item (item.process.pid)}
          <ProcessCard {item} />
        {/each}
      </div>
    {/if}
  </section>

  {#if d.orphanJobs.length || dead.length}
    <section class="two">
      {#if d.orphanJobs.length}
        <div>
          <div class="section-head"><h2>Hintergrund-Jobs</h2><span class="muted">ohne laufenden Prozess</span></div>
          <div class="card">
            <table class="list">
              <tbody>
                {#each d.orphanJobs as j (j.short)}
                  <tr class="clickable" onclick={() => j.sessionId && (location.hash = href.session(j.resumeSessionId ?? j.sessionId))}>
                    <td class="mono">{j.short}</td>
                    <td>
                      <div>{j.name ?? j.intent ?? '–'}</div>
                      <div class="muted ellipsis small">{j.detail ?? ''}</div>
                    </td>
                    <td><span class="badge">{j.state ?? '?'}</span></td>
                    <td class="muted nowrap">{ago(j.updatedAt, clock.now)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
      {#if dead.length}
        <div>
          <div class="section-head"><h2>Beendete Prozesse</h2><span class="muted">Registrierung noch vorhanden</span></div>
          <div class="card">
            <table class="list">
              <tbody>
                {#each dead as item (item.process.pid)}
                  <tr class="clickable" onclick={() => (location.hash = href.session(item.process.sessionId))}>
                    <td>{item.process.name ?? item.process.sessionId.slice(0, 8)}</td>
                    <td class="muted small">{shortPath(item.process.cwd)}</td>
                    <td class="muted nowrap">{ago(item.process.updatedAt ?? item.process.startedAt, clock.now)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <section>
    <div class="section-head">
      <h2>Letzte Sessions</h2>
      <a href={href.sessions()}>alle anzeigen →</a>
    </div>
    <div class="card"><SessionTable sessions={d.recentSessions} /></div>
  </section>
{/if}

<style>
  section {
    margin-bottom: 28px;
  }
  .section-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
  }
  .src {
    margin-left: auto;
    font-size: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(420px, 100%), 1fr));
    gap: 14px;
  }
  .empty {
    padding: 28px;
    text-align: center;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr));
    gap: 20px;
  }
  .small {
    font-size: 12px;
  }
  .nowrap {
    white-space: nowrap;
  }
</style>
