<script lang="ts">
  import type { SearchResult } from '$shared/types';
  import { api } from '../lib/api';
  import { dateTime } from '../lib/format';
  import { href } from '../lib/router.svelte';

  import { untrack } from 'svelte';

  let { q: routeQ }: { q: string } = $props();
  const initial = untrack(() => routeQ);
  let q = $state(initial);
  let result = $state<SearchResult | null>(null);
  let loading = $state(false);
  let error = $state('');

  const KIND: Record<string, string> = {
    'user-text': 'Prompt',
    'assistant-text': 'Response',
    thinking: 'Thinking',
    'tool-use': 'Tool call',
    'tool-result': 'Tool result',
    system: 'System',
    'history-prompt': 'Prompt (history)',
  };

  async function run() {
    const query = q.trim();
    if (query.length < 2) return;
    history.replaceState(null, '', href.search(query));
    loading = true;
    error = '';
    try {
      result = await api.search(query);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }
  if (initial) void run();

  function mark(snippet: string, needle: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const i = snippet.toLowerCase().indexOf(needle.toLowerCase());
    if (i < 0) return esc(snippet);
    return esc(snippet.slice(0, i)) + '<mark>' + esc(snippet.slice(i, i + needle.length)) + '</mark>' + esc(snippet.slice(i + needle.length));
  }

  function target(h: SearchResult['hits'][number]): string | undefined {
    if (h.kind === 'history-prompt') return undefined;
    return href.session(h.sessionId, h.agentId, h.toolUseId ? { tool: h.toolUseId } : { line: h.line });
  }
</script>

<div class="page-head">
  <h2>Search</h2>
  <span class="muted">Full text across all transcripts, subagents and the prompt history · at most 5 hits per file, newest first</span>
</div>
<form class="filters bar" onsubmit={(e) => (e.preventDefault(), run())}>
  <input type="search" placeholder="Search term (at least 2 characters) …" bind:value={q} />
  <button class="btn" type="submit" disabled={loading}>{loading ? 'Searching …' : 'Search'}</button>
  {#if result}
    <span class="faint">{result.hits.length} hits · {result.scannedFiles}/{result.totalFiles} files · {(result.ms / 1000).toFixed(1)} s{result.truncated ? ' · stopped (limit)' : ''}</span>
  {/if}
</form>

{#if error}<p class="badge error">{error}</p>{/if}
{#if result}
  <div class="hits">
    {#each result.hits as h, i (i)}
      {@const t = target(h)}
      <svelte:element this={t ? 'a' : 'div'} class="hit card" href={t}>
        <div class="meta">
          <span class="badge">{KIND[h.kind] ?? h.kind}{h.toolName ? ` · ${h.toolName}` : ''}</span>
          <strong>{h.project}</strong>
          <span class="muted ellipsis">{h.title ?? h.sessionId.slice(0, 8)}{h.agentId ? ' · subagent' : ''}</span>
          <span class="faint when">{dateTime(h.ts)}</span>
        </div>
        <div class="snip">{@html mark(h.snippet, result.query)}</div>
      </svelte:element>
    {/each}
  </div>
  {#if !result.hits.length}<p class="muted">No hits.</p>{/if}
{/if}

<style>
  .bar {
    margin-bottom: 14px;
  }
  .bar input {
    width: min(480px, 100%);
  }
  .hits {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hit {
    display: block;
    padding: 9px 14px;
    color: inherit;
    text-decoration: none;
  }
  a.hit:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    text-decoration: none;
  }
  .meta {
    display: flex;
    gap: 9px;
    align-items: baseline;
    font-size: 12.5px;
    min-width: 0;
  }
  .when {
    margin-left: auto;
    white-space: nowrap;
  }
  .snip {
    margin-top: 3px;
    font-size: 13px;
    color: var(--muted);
    word-break: break-word;
  }
  @media (max-width: 640px) {
    .bar input {
      flex: 1 1 0 !important;
      min-width: 0;
    }
    .meta {
      flex-wrap: wrap;
      row-gap: 2px;
    }
    .snip {
      font-size: 14px;
    }
  }
  .snip :global(mark) {
    background: var(--accent-soft);
    color: var(--text);
    border-radius: 3px;
    padding: 0 2px;
  }
</style>
