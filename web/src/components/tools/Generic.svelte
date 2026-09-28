<script lang="ts">
  import JsonView from '../JsonView.svelte';
  import Output from '../Output.svelte';
  import { resultText, type ToolViewProps } from '../../lib/tool-helpers';

  let { use, result }: ToolViewProps = $props();
  const hasInput = $derived(Object.keys(use.input).length > 0);
</script>

{#if hasInput}<JsonView value={use.input} />{/if}
<Output text={resultText(result)} error={result?.isError} />
{#if result?.structured !== undefined}<JsonView value={result.structured} label="Strukturiertes Ergebnis" />{/if}
