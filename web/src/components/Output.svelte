<script lang="ts">
  let { text, label = '', error = false, max = 360 }: { text: string; label?: string; error?: boolean; max?: number } = $props();
</script>

{#if text}
  <div class="out" class:error>
    {#if label}<div class="label">{label}</div>{/if}
    <pre style:max-height="{max}px">{text}</pre>
  </div>
{/if}

<style>
  .out {
    background: var(--code-bg);
    border-radius: 6px;
    overflow: hidden;
  }
  .out.error {
    background: var(--error-soft);
  }
  .label {
    font-size: 11px;
    color: var(--muted);
    padding: 4px 10px 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  pre {
    padding: 6px 10px 8px;
    overflow: auto;
  }
  .error pre {
    color: var(--error);
  }
</style>
