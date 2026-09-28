<script lang="ts">
  import Output from '../Output.svelte';
  import { resultText, s, structured, type ToolViewProps } from '../../lib/tool-helpers';

  let { use, result }: ToolViewProps = $props();
  const st = $derived(structured(result));
  const params = $derived(
    Object.entries(use.input)
      .filter(([k]) => k !== 'pattern')
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
  );
</script>

<div class="q"><span class="mono pattern">{s(use.input.pattern)}</span>{#each params as p (p)}<span class="badge">{p}</span>{/each}</div>
{#if st?.numFiles !== undefined}<div class="muted small">{st.numFiles} Dateien{st.truncated ? ' (gekürzt)' : ''}</div>{/if}
<Output text={resultText(result)} error={result?.isError} />

<style>
  .q {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .pattern {
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }
</style>
