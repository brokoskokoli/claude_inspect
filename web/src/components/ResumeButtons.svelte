<script lang="ts">
  import type { ResumeCommand } from '$shared/resume';
  import { api } from '../lib/api';

  /**
   * compact = nur Buttons (Tabellenzeilen), sonst mit sichtbarem Befehl.
   * Mit `sessionId` und `launch` startet der Hauptknopf den Befehl in einem neuen Terminalfenster;
   * kopieren geht immer.
   */
  let { commands, compact = false, sessionId, launch = false }: { commands: ResumeCommand[]; compact?: boolean; sessionId?: string; launch?: boolean } = $props();

  const canLaunch = $derived(launch && !!sessionId);
  let copied = $state<string | null>(null);
  let started = $state<string | null>(null);
  let starting = $state<string | null>(null);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flash(set: () => void, reset: () => void) {
    set();
    clearTimeout(timer);
    timer = setTimeout(reset, 2000);
  }

  async function copy(c: ResumeCommand, ev: MouseEvent) {
    ev.stopPropagation(); // Tabellenzeilen sind selbst klickbar
    try {
      await navigator.clipboard.writeText(c.command);
    } catch {
      // ohne Clipboard-API: Befehl zum manuellen Kopieren anbieten
      window.prompt('Copy this command:', c.command);
      return;
    }
    flash(() => (copied = c.kind), () => (copied = null));
  }

  async function run(c: ResumeCommand, ev: MouseEvent) {
    ev.stopPropagation();
    if (!sessionId || starting) return;
    starting = c.kind;
    error = '';
    try {
      await api.launch(sessionId, c.kind);
      flash(() => (started = c.kind), () => (started = null));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      starting = null;
    }
  }

  const runLabel = (c: ResumeCommand) => (starting === c.kind ? 'Opening …' : started === c.kind ? 'Opened ✓' : `▶ ${c.label}`);
</script>

{#if commands.length}
  {#if compact}
    <span class="row">
      {#each commands as c (c.kind)}
        {#if canLaunch}
          <button class="btn" title={`${c.hint} – opens a new terminal window\n\n${c.command}`} disabled={!!starting} onclick={(e) => run(c, e)}>{runLabel(c)}</button>
        {/if}
        <button class="btn" class:icon={canLaunch} title={`Copy: ${c.command}`} onclick={(e) => copy(c, e)}>{copied === c.kind ? '✓' : canLaunch ? '⧉' : c.label}</button>
      {/each}
      {#if error}<span class="badge error" title={error}>failed</span>{/if}
    </span>
  {:else}
    <div class="resume">
      {#each commands as c, i (c.kind)}
        <div class="cmd" class:secondary={i > 0}>
          {#if canLaunch}
            <button class="btn" class:primary={i === 0} title={`${c.hint} – opens a new terminal window`} disabled={!!starting} onclick={(e) => run(c, e)}>{runLabel(c)}</button>
          {/if}
          <button class="btn" class:primary={i === 0 && !canLaunch} title={c.hint} onclick={(e) => copy(c, e)}>
            {copied === c.kind ? 'Copied ✓' : canLaunch ? 'Copy' : `${c.label} · copy`}
          </button>
          <code title={c.hint}>{c.command}</code>
        </div>
      {/each}
      {#if error}<div class="badge error">{error}</div>{/if}
      <div class="faint small">{commands[0].hint.replace(/\.$/, '')}. {canLaunch ? 'Opens in a new terminal window, or copy the command.' : 'Paste into a terminal.'}</div>
    </div>
  {/if}
{/if}

<style>
  .row {
    display: inline-flex;
    gap: 4px;
    align-items: center;
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
  .btn.icon {
    min-width: 0;
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
