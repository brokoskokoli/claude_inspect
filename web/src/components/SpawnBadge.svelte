<script lang="ts">
  import type { SpawnLink } from '$shared/types';

  let { link }: { link: SpawnLink } = $props();
  const tip = $derived(`Match ${link.confidence} – evidence: ${link.evidence.join(', ')}`);
</script>

<span class="conf {link.confidence}" title={tip}>{link.confidence}</span>

<style>
  .conf {
    font-size: 10.5px;
    padding: 0 5px;
    border-radius: 8px;
    line-height: 16px;
    white-space: nowrap;
    background: var(--surface-2);
    color: var(--muted);
  }
  .exact {
    background: color-mix(in srgb, var(--busy) 16%, transparent);
    color: var(--busy);
  }
  .high {
    background: var(--info-soft);
    color: var(--info);
  }
  .likely {
    background: color-mix(in srgb, var(--idle) 18%, transparent);
    color: var(--idle);
  }
</style>
