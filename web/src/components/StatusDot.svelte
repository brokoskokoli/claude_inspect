<script lang="ts">
  /**
   * Status indicator. Only activity is colored:
   *   running/busy  green, pulsing   – working right now
   *   idle          amber            – process alive, waiting for input
   *   done          grey check mark  – finished normally
   *   error         red cross        – ended with an API error
   *   stale         grey ring        – no activity for a while and never finished (e.g. interrupted)
   *   dead          grey dot         – process has ended
   * Shape differs as well, so the state never depends on color alone.
   */
  let { state, size = 9 }: { state: 'busy' | 'idle' | 'dead' | 'error' | 'running' | 'done' | 'stale'; size?: number } = $props();

  const labels: Record<string, string> = {
    busy: 'working right now',
    running: 'running right now',
    idle: 'waiting for input',
    dead: 'process ended',
    done: 'finished',
    stale: 'inactive – stopped without finishing',
    error: 'ended with an error',
  };
  const icon = $derived(Math.max(size + 3, 11));
</script>

{#if state === 'done'}
  <svg class="mark done" width={icon} height={icon} viewBox="0 0 12 12" role="img" aria-label={labels[state]}>
    <title>{labels[state]}</title>
    <path d="M2.5 6.3 5 8.7l4.5-5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
{:else if state === 'error'}
  <svg class="mark error" width={icon} height={icon} viewBox="0 0 12 12" role="img" aria-label={labels[state]}>
    <title>{labels[state]}</title>
    <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
  </svg>
{:else}
  <span class="dot {state}" style:width="{size}px" style:height="{size}px" title={labels[state]} role="img" aria-label={labels[state]}></span>
{/if}

<style>
  .dot {
    display: inline-block;
    border-radius: 50%;
    flex: none;
    background: var(--dead);
  }
  .busy,
  .running {
    background: var(--busy);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--busy) 60%, transparent);
    animation: pulse 1.6s infinite;
  }
  .idle {
    background: var(--idle);
  }
  .stale {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--dead);
  }
  .mark {
    flex: none;
    display: inline-block;
    vertical-align: middle;
  }
  .mark.done {
    color: var(--faint);
  }
  .mark.error {
    color: var(--error);
  }
  @keyframes pulse {
    70% {
      box-shadow: 0 0 0 6px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }
</style>
