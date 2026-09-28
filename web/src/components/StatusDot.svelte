<script lang="ts">
  let { state, size = 9 }: { state: 'busy' | 'idle' | 'dead' | 'error' | 'running' | 'done' | 'stale'; size?: number } = $props();
  const labels: Record<string, string> = {
    busy: 'arbeitet',
    running: 'läuft',
    idle: 'wartet',
    dead: 'beendet',
    done: 'fertig',
    stale: 'inaktiv',
    error: 'Fehler',
  };
</script>

<span class="dot {state}" style:width="{size}px" style:height="{size}px" title={labels[state]}></span>

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
  .done {
    background: color-mix(in srgb, var(--busy) 45%, var(--dead));
  }
  .error {
    background: var(--error);
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
