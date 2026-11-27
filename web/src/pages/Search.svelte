<script lang="ts" module>
  import type { SearchAgent, SearchHit, SearchResult } from '$shared/types';
  import { parseQuery } from '$shared/search-query';

  /** Ergebnisse überleben das Verlassen der Seite (Zurück zu den Treffern), nur die letzten Suchen. */
  interface Cached {
    result?: SearchResult;
    error?: string;
    pending?: Promise<void>;
    scrollY?: number;
  }
  const cache = new Map<string, Cached>();
</script>

<script lang="ts">
  import Spinner from '../components/Spinner.svelte';
  import { api } from '../lib/api';
  import { dateTime } from '../lib/format';
  import { href } from '../lib/router.svelte';

  import { onDestroy, tick, untrack } from 'svelte';

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
    file: 'File name',
    name: 'Name',
  };
  /** Treffer, die zur Session als Ganzes gehören (öffnen das Transcript statt einer Stelle) */
  const isTop = (h: SearchHit) => h.kind === 'file' || h.kind === 'name';

  let current = '';

  function lookup(query: string, fresh: boolean): Cached {
    let c = cache.get(query);
    if (c && fresh && !c.pending) {
      cache.delete(query);
      c = undefined;
    }
    if (!c) {
      const entry: Cached = {};
      entry.pending = api
        .search(query)
        .then(
          (r) => void (entry.result = r),
          (e) => void (entry.error = String(e)),
        )
        .finally(() => (entry.pending = undefined));
      cache.set(query, entry);
      while (cache.size > 5) cache.delete(cache.keys().next().value!);
      c = entry;
    }
    return c;
  }

  /** @param fresh neu suchen statt das gemerkte Ergebnis zu zeigen (Klick auf "Search") */
  async function run(fresh: boolean) {
    const query = q.trim();
    if (query.length < 2) return;
    history.replaceState(null, '', href.search(query));
    current = query;
    const c = lookup(query, fresh);
    error = '';
    if (c.pending) {
      loading = true;
      await c.pending;
      if (current !== query) return;
    }
    result = c.result ?? null;
    error = c.error ?? '';
    loading = false;
    // Zurück zur Trefferliste: an die alte Stelle scrollen
    if (!fresh && c.scrollY) {
      await tick();
      window.scrollTo({ top: c.scrollY });
    }
  }
  if (initial) void run(false);

  // Solange der Suchindex aufgebaut wird, ist das Ergebnis unvollständig: regelmäßig neu suchen
  let retry: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!result?.indexing || loading) return;
    const query = result.query;
    retry = setTimeout(() => {
      if (current === query) void run(true);
    }, 4000);
    return () => clearTimeout(retry);
  });

  onDestroy(() => {
    clearTimeout(retry);
    const c = cache.get(current);
    if (c) c.scrollY = window.scrollY;
  });

  /** Alle Begriffe der Anfrage markieren (wie auf dem Server: Groß-/Kleinschreibung egal) */
  function mark(snippet: string, query: string, file = false): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const terms = parseQuery(query).terms.map((t) => (file ? t.replace(/^~/, '') : t)).filter(Boolean);
    const lower = snippet.toLowerCase();
    const marked = new Array<boolean>(snippet.length).fill(false);
    for (const t of terms) for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + t.length)) marked.fill(true, i, i + t.length);
    let out = '';
    for (let i = 0; i < snippet.length; ) {
      let j = i;
      while (j < snippet.length && marked[j] === marked[i]) j++;
      out += marked[i] ? '<mark>' + esc(snippet.slice(i, j)) + '</mark>' : esc(snippet.slice(i, j));
      i = j;
    }
    return out;
  }

  function target(h: SearchHit): string | undefined {
    if (h.kind === 'history-prompt') return undefined;
    if (isTop(h)) return href.session(h.sessionId, h.agentId, { tab: 'transcript' });
    return href.session(h.sessionId, h.agentId, h.toolUseId ? { tool: h.toolUseId } : { line: h.line });
  }

  const AGENT_KIND = { main: 'Session', subagent: 'Subagent', spawn: 'claude -p' } as const;

  /** Treffer nach Agent gruppiert; Subagenten unter ihrem Hauptagenten, per claude -p gestartete Sessions unter ihrem Aufrufer. */
  interface Node {
    agent: SearchAgent;
    hits: SearchHit[];
    children: Node[];
    latest: number;
    /** bester Treffer in diesem Agenten und darunter */
    best: number;
  }
  const tree = $derived.by(() => {
    const roots: Node[] = [];
    const orphans: SearchHit[] = [];
    if (!result) return { roots, orphans };
    const nodes = new Map<string, Node>();
    for (const [k, agent] of Object.entries(result.agents ?? {})) nodes.set(k, { agent, hits: [], children: [], latest: 0, best: -1 });
    for (const h of result.hits) {
      const n = h.kind === 'history-prompt' ? undefined : nodes.get(h.agentId ? `${h.sessionId}/${h.agentId}` : h.sessionId);
      if (n) n.hits.push(h);
      else orphans.push(h);
    }
    for (const n of nodes.values()) {
      const p = n.agent.parentKey ? nodes.get(n.agent.parentKey) : undefined;
      if (p) p.children.push(n);
      else roots.push(n);
    }
    // beste Treffer zuerst (siehe score auf dem Server), bei Gleichstand die neuesten
    const byRank = (a: Node, b: Node) => b.best - a.best || b.latest - a.latest;
    const order = (n: Node) => {
      n.hits.sort((a, b) => b.score - a.score || (b.ts ?? '').localeCompare(a.ts ?? ''));
      n.best = Math.max(-1, ...n.hits.map((h) => h.score));
      n.latest = Math.max(0, ...n.hits.map((h) => (h.ts ? Date.parse(h.ts) : 0)));
      for (const c of n.children) {
        order(c);
        n.best = Math.max(n.best, c.best);
        n.latest = Math.max(n.latest, c.latest);
      }
      n.children.sort(byRank);
    };
    roots.forEach(order);
    roots.sort(byRank);
    orphans.sort((a, b) => b.score - a.score || (b.ts ?? '').localeCompare(a.ts ?? ''));
    return { roots, orphans };
  });
</script>

<div class="page-head">
  <h2>Search</h2>
  <span class="muted">Full text, session and agent names and file names across all transcripts, subagents and the prompt history · ignores case and line breaks · several words: all in the same entry · <code>"…"</code> exact phrase · <code>~3</code> within 3 consecutive entries · from 3 terms on also partial hits · best hits first · grouped by agent · at most 5 hits per file</span>
</div>
<form class="filters bar" onsubmit={(e) => (e.preventDefault(), run(true))}>
  <input type="search" placeholder={'Words, "exact phrase", ~3 for neighbouring entries …'} bind:value={q} />
  <button class="btn" type="submit" disabled={loading}>{#if loading}<Spinner /> Searching …{:else}Search{/if}</button>
  {#if result}
    <span class="faint">{result.hits.length} hits · {result.totalFiles} files · {(result.ms / 1000).toFixed(1)} s{result.truncated ? ` · hit limit reached, ${result.moreFiles ?? 'more'} more transcripts have weaker hits – refine the search to see them` : ''}</span>
  {/if}
</form>
{#if result?.indexing}
  <p class="badge info indexing"><Spinner /> Building the search index ({result.indexing.files}/{result.indexing.total} files) – only once, results are incomplete until it is done and update by themselves</p>
{/if}

{#if error}<p class="badge error">{error}</p>{/if}
{#if loading && !result}
  <p class="muted"><Spinner /> Searching all transcripts – this can take a few seconds …</p>
{/if}
{#if result}
  {#if tree.roots.length}
    <div class="tree">
      {#each tree.roots as n (n.agent.key)}
        <div class="card group">{@render agentNode(n, 0)}</div>
      {/each}
    </div>
  {/if}
  {#if tree.orphans.length}
    <h3 class="orphans-head">Prompt history <span class="faint">(transcript no longer exists)</span></h3>
    <div class="card group">
      {#each tree.orphans as h, i (i)}
        <div class="hit">
          <div class="meta"><span class="badge">{KIND[h.kind] ?? h.kind}</span>{@render partial(h)}<strong>{h.project}</strong><span class="faint when">{dateTime(h.ts)}</span></div>
          <div class="snip">{@html mark(h.snippet, result.query)}</div>
        </div>
      {/each}
    </div>
  {/if}
  {#if !result.hits.length}<p class="muted">No hits.</p>{/if}
{/if}

{#snippet partial(h: SearchHit)}
  {#if result?.terms && h.matched < result.terms}<span class="badge info" title="Not all search terms appear here – ranked below hits with all terms">{h.matched}/{result.terms} terms</span>{/if}
{/snippet}

{#snippet agentNode(n: Node, depth: number)}
  <div class="agent" class:nested={depth > 0}>
    <a class="agent-row" href={href.session(n.agent.sessionId, n.agent.agentId, { tab: 'transcript' })} title="Open the transcript of this agent">
      <span class="badge {n.agent.kind}">{AGENT_KIND[n.agent.kind]}</span>
      <strong class="ellipsis">{n.agent.label}</strong>
      {#if n.agent.sublabel}<span class="muted ellipsis">{n.agent.sublabel}</span>{/if}
      <span class="faint project">{n.agent.project}</span>
      <span class="faint count">{n.hits.length ? `${n.hits.length} ${n.hits.length === 1 ? 'hit' : 'hits'}` : n.children.length ? 'started the agents below' : ''}</span>
    </a>
    {#if n.hits.length}
      <div class="agent-hits">
        {#each n.hits as h, i (i)}
          <a class="hit" href={target(h)}>
            <div class="meta">
              <span class="badge">{KIND[h.kind] ?? h.kind}{h.toolName ? ` · ${h.toolName}` : ''}</span>
              {@render partial(h)}
              {#if h.span}<span class="faint" title="The terms appear within this entry and the following ones">across {h.span} entries</span>{/if}
              <span class="faint when">{dateTime(h.ts)}</span>
            </div>
            <div class="snip" class:mono={h.kind === 'file'} class:name={h.kind === 'name'}>{@html mark(h.snippet, result!.query, h.kind === 'file')}</div>
          </a>
        {/each}
      </div>
    {/if}
    {#each n.children as c (c.agent.key)}{@render agentNode(c, depth + 1)}{/each}
  </div>
{/snippet}

<style>
  .bar {
    margin-bottom: 14px;
  }
  .bar input {
    width: min(480px, 100%);
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .group {
    padding: 6px 8px;
  }
  .agent.nested {
    margin-left: 18px;
    padding-left: 10px;
    border-left: 2px solid var(--border);
  }
  .agent-row {
    display: flex;
    align-items: baseline;
    gap: 9px;
    min-width: 0;
    padding: 6px 8px;
    border-radius: 6px;
    color: inherit;
    text-decoration: none;
    font-size: 13px;
  }
  .agent-row:hover {
    background: var(--surface-2);
    text-decoration: none;
  }
  .agent-row .badge.subagent {
    background: var(--info-soft);
    color: var(--info);
  }
  .agent-row .badge.spawn {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .project {
    white-space: nowrap;
  }
  .count {
    margin-left: auto;
    white-space: nowrap;
  }
  .agent-hits {
    margin: 0 0 4px 18px;
    display: flex;
    flex-direction: column;
  }
  .hit {
    display: block;
    padding: 6px 10px;
    border-radius: 6px;
    color: inherit;
    text-decoration: none;
  }
  a.hit:hover {
    background: var(--surface-2);
    text-decoration: none;
  }
  .indexing {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin: 0 0 12px;
    white-space: normal;
  }
  .snip.name {
    color: var(--text);
  }
  .orphans-head {
    font-size: 14px;
    margin: 18px 0 8px;
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
    .meta,
    .agent-row {
      flex-wrap: wrap;
      row-gap: 2px;
    }
    .agent.nested {
      margin-left: 8px;
      padding-left: 8px;
    }
    .agent-hits {
      margin-left: 6px;
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
