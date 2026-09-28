<script lang="ts">
  import Output from '../Output.svelte';
  import { isObj, n, resultText, s, structured, type ToolViewProps } from '../../lib/tool-helpers';

  let { use, result }: ToolViewProps = $props();
  const st = $derived(structured(result));
  const file = $derived(isObj(st?.file) ? st.file : undefined);
  const content = $derived(s(file?.content));
  const numbered = $derived.by(() => {
    if (content === undefined) return undefined;
    const start = n(file?.startLine) ?? 1;
    return content
      .split('\n')
      .map((l, i) => `${String(start + i).padStart(5)}  ${l}`)
      .join('\n');
  });
</script>

<div class="path mono">
  {s(use.input.file_path)}
  {#if use.input.offset || use.input.limit}<span class="muted">· ab {use.input.offset ?? 1}, {use.input.limit ?? '∞'} Zeilen</span>{/if}
  {#if file?.totalLines}<span class="muted">· {n(file.numLines)} / {n(file.totalLines)} Zeilen</span>{/if}
</div>
{#if st?.type === 'image'}
  <span class="badge">Bild gelesen</span>
{:else if numbered !== undefined}
  <Output text={numbered} />
{:else}
  <Output text={resultText(result)} error={result?.isError} />
{/if}

<style>
  .path {
    font-size: 12px;
    word-break: break-all;
  }
</style>
