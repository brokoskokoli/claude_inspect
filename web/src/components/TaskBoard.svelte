<script lang="ts">
  import type { TaskItem } from '$shared/types';

  let { tasks }: { tasks: TaskItem[] } = $props();

  const COLS = [
    { key: 'pending', label: 'Offen' },
    { key: 'in_progress', label: 'In Arbeit' },
    { key: 'completed', label: 'Erledigt' },
  ];
  const known = new Set(COLS.map((c) => c.key));
  const byCol = $derived(
    COLS.map((c) => ({ ...c, items: tasks.filter((t) => t.status === c.key) })).concat(
      tasks.some((t) => !known.has(t.status ?? ''))
        ? [{ key: 'other', label: 'Sonstige', items: tasks.filter((t) => !known.has(t.status ?? '')) }]
        : [],
    ),
  );
  const subject = (id: string) => tasks.find((t) => t.id === id)?.subject ?? `#${id}`;
</script>

{#if !tasks.length}
  <p class="muted">Diese Session hat keine Task-Liste angelegt.</p>
{:else}
  <div class="board">
    {#each byCol as col (col.key)}
      <div class="col">
        <div class="col-head">{col.label} <span class="faint">{col.items.length}</span></div>
        {#each col.items as t (t.id)}
          <div class="task card" class:done={t.status === 'completed'}>
            <div class="subj"><span class="faint">#{t.id}</span> {t.subject ?? '(ohne Titel)'}</div>
            {#if t.status === 'in_progress' && t.activeForm}<div class="active">{t.activeForm} …</div>{/if}
            {#if t.description}<details><summary>Beschreibung</summary><p>{t.description}</p></details>{/if}
            {#if t.blockedBy.length}<div class="dep">⛔ wartet auf {t.blockedBy.map(subject).join(', ')}</div>{/if}
            {#if t.blocks.length}<div class="dep faint">blockiert {t.blocks.map(subject).join(', ')}</div>{/if}
            {#if t.owner}<div class="faint small">Besitzer: {t.owner}</div>{/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .board {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .col-head {
    font-weight: 600;
    font-size: 13px;
  }
  .task {
    padding: 9px 12px;
    font-size: 13px;
  }
  .task.done {
    background: var(--surface-2);
    box-shadow: none;
    color: var(--muted);
  }
  .subj {
    font-weight: 500;
  }
  .active {
    font-size: 12px;
    color: var(--busy);
    margin-top: 2px;
  }
  details {
    margin-top: 4px;
    font-size: 12.5px;
  }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 12px;
  }
  details p {
    margin: 4px 0 0;
    white-space: pre-wrap;
  }
  .dep {
    font-size: 12px;
    margin-top: 4px;
  }
  .small {
    font-size: 11.5px;
  }
</style>
