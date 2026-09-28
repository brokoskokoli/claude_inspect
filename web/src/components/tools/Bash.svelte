<script lang="ts">
  import Output from '../Output.svelte';
  import { resultText, s, structured, type ToolViewProps } from '../../lib/tool-helpers';

  let { use, result }: ToolViewProps = $props();
  const st = $derived(structured(result));
  const stdout = $derived(s(st?.stdout));
  const stderr = $derived(s(st?.stderr));
</script>

<pre class="cmd">$ {s(use.input.command)}</pre>
<div class="flags">
  {#if use.input.run_in_background}<span class="badge info">background</span>{/if}
  {#if use.input.timeout}<span class="badge">Timeout {Number(use.input.timeout) / 1000}s</span>{/if}
  {#if st?.interrupted}<span class="badge error">interrupted</span>{/if}
  {#if st?.backgroundTaskId}<span class="badge">Task {s(st.backgroundTaskId)}</span>{/if}
  {#if st?.returnCodeInterpretation}<span class="badge">{s(st.returnCodeInterpretation)}</span>{/if}
</div>
{#if st && (stdout !== undefined || stderr !== undefined)}
  <Output text={stdout ?? ''} label={stderr ? 'stdout' : ''} />
  <Output text={stderr ?? ''} label="stderr" error />
  {#if result?.isError && !stdout && !stderr}<Output text={resultText(result)} error />{/if}
{:else}
  <Output text={resultText(result)} error={result?.isError} />
{/if}

<style>
  .cmd {
    padding: 6px 10px;
    background: var(--code-bg);
    border-radius: 6px;
    font-weight: 500;
  }
  .flags {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .flags:empty {
    display: none;
  }
</style>
