<script lang="ts">
  import { duration, modelName, tokens } from '../../lib/format';
  import { markdown } from '../../lib/markdown';
  import { href } from '../../lib/router.svelte';
  import { n, resultText, s, structured, type ToolViewProps } from '../../lib/tool-helpers';
  import StatusDot from '../StatusDot.svelte';

  let { use, result, sessionId, subagent }: ToolViewProps = $props();
  const st = $derived(structured(result));
  const agentId = $derived(subagent?.agentId ?? s(st?.agentId));
  const text = $derived(resultText(result));
</script>

<div class="meta">
  {#if use.input.subagent_type}<span class="badge accent">{s(use.input.subagent_type)}</span>{/if}
  {#if use.input.model}<span class="badge">{s(use.input.model)}</span>{/if}
  {#if st?.resolvedModel}<span class="badge">{modelName(s(st.resolvedModel))}</span>{/if}
  {#if use.input.run_in_background || st?.isAsync}<span class="badge info">background</span>{/if}
  {#if use.input.isolation}<span class="badge">{s(use.input.isolation)}</span>{/if}
  {#if agentId}
    <a class="open" href={href.session(sessionId, agentId)}>
      {#if subagent}<StatusDot state={subagent.status} size={7} />{/if}
      Open subagent →
    </a>
  {/if}
</div>
{#if st && (st.totalDurationMs || st.totalTokens)}
  <div class="stats muted">
    {#if n(st.totalDurationMs)}<span>{duration(n(st.totalDurationMs)!)}</span>{/if}
    {#if n(st.totalTokens)}<span>{tokens(n(st.totalTokens))} tokens</span>{/if}
    {#if n(st.totalToolUseCount) !== undefined}<span>{n(st.totalToolUseCount)} tool calls</span>{/if}
  </div>
{/if}
<details>
  <summary>Task (prompt)</summary>
  <pre class="prompt">{s(use.input.prompt)}</pre>
</details>
{#if text && st?.status !== 'async_launched'}
  <details open>
    <summary>Result</summary>
    <div class="md">{@html markdown(text)}</div>
  </details>
{:else if st?.status === 'async_launched'}
  <div class="muted small">Started in the background – the result arrives as a notification.</div>
{/if}

<style>
  .meta,
  .stats {
    display: flex;
    gap: 6px 12px;
    flex-wrap: wrap;
    align-items: center;
    font-size: 12.5px;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font-weight: 500;
  }
  summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
  }
  .prompt {
    padding: 8px 10px;
    background: var(--code-bg);
    border-radius: 6px;
    max-height: 320px;
    overflow: auto;
    margin-top: 4px;
  }
  .md {
    margin-top: 4px;
    padding: 4px 0 0 10px;
    border-left: 2px solid var(--border);
  }
  .small {
    font-size: 12px;
  }
</style>
