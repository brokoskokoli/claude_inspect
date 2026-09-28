<script lang="ts">
  let { value, label = '', open = false }: { value: unknown; label?: string; open?: boolean } = $props();
  const text = $derived(JSON.stringify(value, null, 2));
</script>

{#if label}
  <details {open}>
    <summary>{label}</summary>
    <pre class="json">{text}</pre>
  </details>
{:else}
  <pre class="json">{text}</pre>
{/if}

<style>
  summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
    user-select: none;
  }
  .json {
    max-height: 420px;
    overflow: auto;
    padding: 8px 10px;
    margin-top: 4px;
    background: var(--code-bg);
    border-radius: 6px;
    font-size: 12px;
  }
</style>
