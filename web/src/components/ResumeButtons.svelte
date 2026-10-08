<script lang="ts">
  import type { ResumeCommand } from '$shared/resume';

  /** compact = nur Buttons (Tabellenzeilen), sonst mit sichtbarem Befehl */
  let { commands, compact = false }: { commands: ResumeCommand[]; compact?: boolean } = $props();

  let copied = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(c: ResumeCommand, ev: MouseEvent) {
    ev.stopPropagation(); // Tabellenzeilen sind selbst klickbar
    try {
      await navigator.clipboard.writeText(c.command);
      copied = c.kind;
    } catch {
      // ohne Clipboard-API: Befehl zum manuellen Kopieren anbieten
      window.prompt('Copy this command:', c.command);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => (copied = null), 1600);
  }
</script>

{#if commands.length}
  {#if compact}
    <span class="row">
      {#each commands as c (c.kind)}
        <button class="btn" title={`${c.hint}\n\n${c.command}`} onclick={(e) => copy(c, e)}>{copied === c.kind ? 'Copied ✓' : c.label}</button>
      {/each}
    </span>
  {:else}
    <div class="resume">
      {#each commands as c, i (c.kind)}
        <div class="cmd" class:secondary={i > 0}>
          <button class="btn" class:primary={i === 0} title={c.hint} onclick={(e) => copy(c, e)}>
            {copied === c.kind ? 'Copied ✓' : `${c.label} · copy`}
          </button>
          <code title={c.hint}>{c.command}</code>
        </div>
      {/each}
      <div class="faint small">{commands[0].hint}. Paste into a terminal.</div>
    </div>
  {/if}
{/if}

<style>
  .row {
    display: inline-flex;
    gap: 4px;
  }
  .resume {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cmd {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .cmd code {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    user-select: all;
  }
  .secondary code {
    opacity: 0.7;
  }
  .btn {
    white-space: nowrap;
    min-width: 92px;
  }
  @media (max-width: 640px) {
    .cmd {
      flex-wrap: wrap;
    }
    .cmd code {
      flex: 1 1 100%;
      overflow-x: auto;
      text-overflow: clip;
      padding: 4px 0;
    }
  }
  .btn.primary {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
