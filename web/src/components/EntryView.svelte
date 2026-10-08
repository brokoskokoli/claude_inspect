<script lang="ts">
  import type { Entry } from '$shared/types';
  import { modelName, time, tokens } from '../lib/format';
  import { markdown } from '../lib/markdown';
  import { showRaw } from '../lib/raw.svelte';
  import { parseUserText } from '../lib/tool-helpers';
  import JsonView from './JsonView.svelte';
  import Output from './Output.svelte';

  let { e, sessionId, agentId }: { e: Entry; sessionId: string; agentId?: string } = $props();

  let thinkingOpen = $state(false);
  let extraOpen = $state(false);
  const userView = $derived(e.kind === 'user-text' ? parseUserText(e.text) : undefined);

  function systemLine(): string {
    if (e.kind !== 'system') return '';
    const d = e.data as Record<string, any>;
    switch (e.subtype) {
      case 'turn_duration':
        return `Turn finished after ${Math.round((d.durationMs ?? 0) / 1000)}s · ${d.messageCount ?? '?'} messages`;
      case 'stop_hook_summary':
        return `Stop-Hooks: ${d.hookCount ?? 0}${d.hookErrors?.length ? ` · ${d.hookErrors.length} errors` : ''}${d.preventedContinuation ? ' · continuation prevented' : ''}`;
      case 'compact_boundary':
        return `Context compacted (${d.compactMetadata?.trigger ?? '?'}, ${tokens(d.compactMetadata?.preTokens)} tokens before)`;
      case 'api_error':
        return `API error: ${d.error?.message ?? e.text ?? '?'} · attempt ${d.retryAttempt ?? '?'}/${d.maxRetries ?? '?'}`;
      case 'local_command':
        return (e.text ?? '').replace(/<\/?[a-z-]+>/g, ' ').replace(/\s+/g, ' ').trim();
      default:
        return e.text ?? '';
    }
  }

  function metaLine(): string {
    if (e.kind !== 'meta') return '';
    const d = e.data as Record<string, any>;
    switch (e.metaType) {
      case 'custom-title':
        return `Title: ${d.customTitle}`;
      case 'ai-title':
        return `AI title: ${d.aiTitle}`;
      case 'agent-name':
        return `Agent name: ${d.agentName}`;
      case 'mode':
        return `Mode: ${d.mode}`;
      case 'permission-mode':
        return `Permission mode: ${d.permissionMode}`;
      case 'queue-operation':
        return `Queue ${d.operation}${d.content ? `: ${String(d.content).slice(0, 160)}` : ''}`;
      case 'cost-state':
        return `Cost: $${Number(d.totalCostUSD ?? 0).toFixed(2)} · +${d.totalLinesAdded ?? 0}/−${d.totalLinesRemoved ?? 0} lines`;
      case 'worktree-state':
        return `Worktree: ${JSON.stringify(d.worktreeSession)}`;
      case 'relocated':
        return `Working directory changed: ${d.relocatedCwd}`;
      case 'continued-in':
        return `Continued in session ${d.continuedInSessionId}`;
      default:
        return e.metaType;
    }
  }
</script>

<div class="entry {e.kind}" class:sidechain={e.isSidechain && !agentId}>
  {#if e.kind === 'user-text'}
    {#if userView?.type === 'command'}
      <div class="line cmd"><span class="tag">Command</span><span class="mono">{userView.name} {userView.args}</span></div>
    {:else if userView?.type === 'stdout'}
      <Output text={userView.text} label="Output" max={200} />
    {:else if userView?.type === 'notification'}
      <div class="notif"><span class="tag">Notification</span><pre>{userView.text}</pre></div>
    {:else if userView?.type === 'meta' || e.isMeta}
      <details class="line dim"><summary>Context for the model</summary><pre>{e.text}</pre></details>
    {:else}
      <div class="user">
        <div class="who">
          {e.isCompactSummary ? 'Summary (compaction)' : agentId ? 'Task' : 'User'}
          {#if e.promptSource && e.promptSource !== 'user'}<span class="badge">{e.promptSource}</span>{/if}
          {#if e.permissionMode}<span class="badge">{e.permissionMode}</span>{/if}
        </div>
        <pre class="text">{e.text}</pre>
      </div>
    {/if}
  {:else if e.kind === 'assistant-text'}
    <div class="assistant" class:apierr={e.isApiError}>
      <div class="who">
        {modelName(e.model)}
        {#if e.attribution?.skill}<span class="badge">Skill {e.attribution.skill}</span>{/if}
        {#if e.usage}<span class="faint">ctx {tokens((e.usage.input_tokens ?? 0) + (e.usage.cache_read_input_tokens ?? 0) + (e.usage.cache_creation_input_tokens ?? 0))} · out {tokens(e.usage.output_tokens)}</span>{/if}
      </div>
      <div class="md">{@html markdown(e.text)}</div>
    </div>
  {:else if e.kind === 'thinking'}
    <button class="line think" onclick={() => (thinkingOpen = !thinkingOpen)}>
      <span class="tag">{thinkingOpen ? '▾' : '▸'} Thinking</span>
      {#if !thinkingOpen}<span class="ellipsis">{e.redacted ? '(encrypted)' : e.text}</span>{/if}
    </button>
    {#if thinkingOpen}<pre class="think-body">{e.redacted ? '(encrypted)' : e.text}</pre>{/if}
  {:else if e.kind === 'image'}
    <div class="line"><span class="tag">Image</span><span class="muted">{e.mediaType}</span></div>
  {:else if e.kind === 'system'}
    <div class="line sys {e.subtype}" class:err={e.level === 'error' || e.subtype === 'api_error'}>
      <span class="tag">{e.subtype}</span><span class="ellipsis">{systemLine()}</span>
    </div>
  {:else if e.kind === 'attachment'}
    <details class="line dim">
      <summary><span class="tag">Attachment</span> {e.attachmentType}</summary>
      <JsonView value={e.data} />
    </details>
  {:else if e.kind === 'meta'}
    <details class="line dim">
      <summary><span class="tag">{e.metaType}</span> {metaLine()}</summary>
      <JsonView value={e.data} />
    </details>
  {:else if e.kind === 'tool-result'}
    <div class="line"><span class="tag">Tool result without call</span><span class="mono faint">{e.toolUseId}</span></div>
  {:else if e.kind === 'unknown'}
    <div class="unknown">
      <span class="tag">Unknown record: {e.recordType}</span>
      <JsonView value={e.raw} />
    </div>
  {/if}
  {#if extraOpen && e.extra}<JsonView value={e.extra} />{/if}
  <div class="side">
    {#if e.extra && e.kind !== 'unknown'}
      <button class="icon-btn" title="Fields no decoder knows: {Object.keys(e.extra).join(', ')}" onclick={() => (extraOpen = !extraOpen)}
        >+{Object.keys(e.extra).length}</button
      >
    {/if}
    <span class="ts">{time(e.timestamp)}</span>
    <button class="icon-btn" title="Raw data (line {e.line + 1}, decoder {e.decoder})" onclick={() => showRaw(sessionId, agentId, e.line)}>{'{ }'}</button>
  </div>
</div>

<style>
  .entry {
    position: relative;
    padding-right: 110px;
  }
  .side {
    position: absolute;
    right: 0;
    top: 2px;
    display: flex;
    gap: 4px;
    align-items: baseline;
    opacity: 0.55;
  }
  .entry:hover .side {
    opacity: 1;
  }
  @media (max-width: 640px) {
    .entry {
      display: flex;
      flex-direction: column;
      padding-right: 0;
    }
    .side {
      position: static;
      order: -1;
      align-self: flex-end;
      align-items: center;
      margin-bottom: -6px;
    }
    .side .icon-btn {
      min-height: 32px;
      min-width: 44px;
    }
    .think {
      min-height: 44px;
    }
    details.line summary {
      padding: 10px 0;
    }
  }
  .ts {
    font-size: 11.5px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .who {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 3px;
  }
  .who .faint {
    font-weight: 400;
  }
  .user {
    background: var(--accent-soft);
    border-radius: 10px;
    padding: 8px 12px;
  }
  .user .text {
    font-family: var(--sans);
    font-size: 14px;
    max-height: 420px;
    overflow: auto;
  }
  .assistant {
    padding: 2px 0;
  }
  .assistant.apierr {
    color: var(--error);
  }
  .md :global(p) {
    margin: 0 0 2px;
  }
  .md :global(.md-gap) {
    height: 8px;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 2px 0;
    padding-left: 22px;
  }
  .md :global(code) {
    background: var(--code-bg);
    padding: 0 4px;
    border-radius: 4px;
  }
  .md :global(.md-code) {
    background: var(--code-bg);
    padding: 8px 10px;
    border-radius: 6px;
    margin: 4px 0;
    overflow: auto;
    max-height: 400px;
  }
  .md :global(.md-h) {
    font-weight: 600;
    margin: 6px 0 2px;
  }
  .md :global(.md-h1),
  .md :global(.md-h2) {
    font-size: 15px;
  }
  .md :global(.md-table) {
    border-collapse: collapse;
    margin: 4px 0;
    font-size: 13px;
  }
  .md :global(.md-table td),
  .md :global(.md-table th) {
    border: 1px solid var(--border);
    padding: 2px 8px;
    text-align: left;
    vertical-align: top;
  }
  .line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12.5px;
    color: var(--muted);
    min-width: 0;
  }
  details.line {
    display: block;
  }
  details.line summary {
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    flex: none;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--faint);
  }
  .dim {
    opacity: 0.8;
  }
  .think {
    border: none;
    background: none;
    padding: 0;
    width: 100%;
    text-align: left;
    font-style: italic;
  }
  .think-body {
    font-family: var(--sans);
    font-size: 13px;
    font-style: italic;
    color: var(--muted);
    padding: 4px 0 4px 12px;
    border-left: 2px solid var(--border);
  }
  .sys.err {
    color: var(--error);
  }
  .sys.compact_boundary {
    padding: 6px 0;
    border-top: 1px dashed var(--border);
    border-bottom: 1px dashed var(--border);
    color: var(--info);
  }
  .cmd .mono {
    color: var(--text);
  }
  .notif {
    padding: 6px 10px;
    border-left: 3px solid var(--info);
    background: var(--info-soft);
    border-radius: 4px;
    font-size: 12.5px;
  }
  .notif pre {
    max-height: 160px;
    overflow: auto;
  }
  .unknown {
    padding: 6px 10px;
    border: 1px dashed var(--error);
    border-radius: 6px;
  }
</style>
