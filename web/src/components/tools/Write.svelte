<script lang="ts">
  import Diff from '../Diff.svelte';
  import Output from '../Output.svelte';
  import { hunks, resultText, s, structured, type ToolViewProps } from '../../lib/tool-helpers';

  let { use, result }: ToolViewProps = $props();
  const st = $derived(structured(result));
  const patch = $derived(st?.type === 'update' ? hunks(st.structuredPatch) : undefined);
</script>

<div class="path mono">
  {s(use.input.file_path)}
  {#if st?.type}<span class="badge">{st.type === 'create' ? 'neu' : st.type === 'update' ? 'überschrieben' : s(st.type)}</span>{/if}
</div>
{#if patch}
  <Diff hunks={patch} />
{:else}
  <Output text={s(use.input.content) ?? ''} max={420} />
{/if}
{#if result?.isError}<Output text={resultText(result)} error />{/if}

<style>
  .path {
    font-size: 12px;
    word-break: break-all;
    display: flex;
    gap: 8px;
    align-items: center;
  }
</style>
