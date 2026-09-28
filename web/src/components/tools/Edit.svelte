<script lang="ts">
  import Diff from '../Diff.svelte';
  import Output from '../Output.svelte';
  import { hunks, isObj, resultText, s, structured, type ToolViewProps } from '../../lib/tool-helpers';

  let { use, result }: ToolViewProps = $props();
  const st = $derived(structured(result));
  const patch = $derived(hunks(st?.structuredPatch));
  const edits = $derived(Array.isArray(use.input.edits) ? use.input.edits.filter(isObj) : undefined);
</script>

<div class="path mono">
  {s(use.input.file_path)}
  {#if use.input.replace_all}<span class="badge">alle Vorkommen</span>{/if}
  {#if st?.userModified}<span class="badge info">vom Nutzer angepasst</span>{/if}
</div>
{#if patch}
  <Diff hunks={patch} />
{:else if edits}
  {#each edits as e, i (i)}<Diff oldStr={s(e.old_string)} newStr={s(e.new_string)} />{/each}
{:else}
  <Diff oldStr={s(use.input.old_string)} newStr={s(use.input.new_string)} />
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
