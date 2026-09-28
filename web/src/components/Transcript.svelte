<script lang="ts">
  import type { Entry, SpawnedSession, SubagentInfo, ToolResultEntry, ToolUseEntry } from '$shared/types';
  import { tick, untrack } from 'svelte';
  import { api } from '../lib/api';
  import { onTranscript } from '../lib/live.svelte';
  import EntryView from './EntryView.svelte';
  import ToolCall from './ToolCall.svelte';

  let {
    sessionId,
    agentId,
    subagents,
    spawned,
    live,
    focusTool,
    focusLine,
  }: {
    sessionId: string;
    agentId?: string;
    subagents: SubagentInfo[];
    spawned: SpawnedSession[];
    live: boolean;
    /** Zu diesem Tool-Aufruf springen (aufgeklappt, hervorgehoben). */
    focusTool?: string;
    /** Zu dieser Zeilennummer der Quelldatei springen. */
    focusLine?: number;
  } = $props();

  let focusKey = $state<number | undefined>(undefined);

  const WINDOW = 400;

  // $state.raw: große Arrays nicht tief proxieren
  let entries = $state.raw<Entry[]>([]);
  let loading = $state(true);
  let error = $state('');
  let shown = $state(WINDOW);
  let follow = $state(true);
  let filters = $state({ thinking: true, tools: true, system: true, attachments: false, meta: false });
  let query = $state('');

  let fetching = false;
  let pending = false;

  async function load(reset: boolean) {
    if (fetching) {
      pending = true;
      return;
    }
    fetching = true;
    try {
      const from = reset ? 0 : entries.length;
      const page = await api.transcript(sessionId, agentId, from);
      if (page.total < from) return load(true); // Datei neu geschrieben
      entries = reset ? page.entries : [...entries, ...page.entries];
      error = '';
      loading = false;
      if (reset && (focusTool || focusLine !== undefined)) {
        await focus();
        return;
      }
      if (follow) {
        await tick();
        window.scrollTo({ top: document.body.scrollHeight });
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      fetching = false;
      if (pending) {
        pending = false;
        void load(false);
      }
    }
  }

  $effect(() => {
    void sessionId;
    void agentId;
    untrack(() => {
      entries = [];
      loading = true;
      shown = WINDOW;
      follow = live;
      void load(true);
    });
    return onTranscript((ev) => {
      if (ev.sessionId === sessionId && (ev.agentId ?? undefined) === agentId && ev.total !== entries.length) void load(false);
    });
  });

  /** Springt zum per URL angegebenen Eintrag (aus Suche, Tool-Explorer, Zeitleiste). */
  async function focus() {
    let target: Entry | undefined;
    if (focusTool) target = entries.find((e) => e.kind === 'tool-use' && e.toolUseId === focusTool);
    else if (focusLine !== undefined) {
      target = entries.find((e) => e.line === focusLine);
      if (target?.kind === 'tool-result') {
        const id = target.toolUseId;
        target = entries.find((e) => e.kind === 'tool-use' && e.toolUseId === id) ?? target;
      }
    }
    if (!target) return;
    follow = false;
    // Filter lockern, falls der Eintrag sonst ausgeblendet wäre
    if (target.kind === 'attachment') filters.attachments = true;
    if (target.kind === 'meta') filters.meta = true;
    if (target.kind === 'system') filters.system = true;
    if (target.kind === 'thinking') filters.thinking = true;
    if (target.kind === 'tool-use') filters.tools = true;
    focusKey = target.seq;
    await tick();
    const idx = items.findIndex((it) => it.key === target!.seq);
    if (idx >= 0 && items.length - idx > shown) shown = items.length - idx + 20;
    await tick();
    document.getElementById(`e-${target.seq}`)?.scrollIntoView({ block: 'center' });
  }

  function onScroll() {
    follow = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  }

  type Item = { key: number; e: Entry } | { key: number; use: ToolUseEntry; result?: ToolResultEntry };

  const results = $derived.by(() => {
    const m = new Map<string, ToolResultEntry>();
    for (const e of entries) if (e.kind === 'tool-result') m.set(e.toolUseId, e);
    return m;
  });
  const useIds = $derived(new Set(entries.flatMap((e) => (e.kind === 'tool-use' ? [e.toolUseId] : []))));
  const spawnedByToolUse = $derived.by(() => {
    const m = new Map<string, SpawnedSession[]>();
    for (const c of spawned) if (c.toolUseId) m.set(c.toolUseId, [...(m.get(c.toolUseId) ?? []), c]);
    return m;
  });
  const subByToolUse = $derived(new Map(subagents.filter((s) => s.toolUseId).map((s) => [s.toolUseId!, s])));

  function matches(e: Entry, q: string): boolean {
    if (!q) return true;
    const hay =
      e.kind === 'tool-use'
        ? e.name + ' ' + JSON.stringify(e.input) + ' ' + JSON.stringify(results.get(e.toolUseId)?.parts ?? '')
        : 'text' in e && e.text
          ? e.text
          : JSON.stringify(e);
    return hay.toLowerCase().includes(q);
  }

  const items = $derived.by((): Item[] => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    for (const e of entries) {
      switch (e.kind) {
        case 'tool-use':
          if (!filters.tools) continue;
          break;
        case 'tool-result':
          if (useIds.has(e.toolUseId) || !filters.tools) continue;
          break;
        case 'thinking':
          // Claude Code speichert Thinking meist ohne Inhalt – leere Blöcke tragen keine Information.
          if (!filters.thinking || (!e.text && !e.redacted)) continue;
          break;
        case 'system':
          if (!filters.system) continue;
          break;
        case 'attachment':
          if (!filters.attachments) continue;
          break;
        case 'meta':
          if (!filters.meta) continue;
          break;
      }
      if (!matches(e, q)) continue;
      out.push(e.kind === 'tool-use' ? { key: e.seq, use: e, result: results.get(e.toolUseId) } : { key: e.seq, e });
    }
    return out;
  });

  const visible = $derived(items.slice(Math.max(0, items.length - shown)));
  const counts = $derived.by(() => {
    const c: Record<string, number> = {};
    for (const e of entries) {
      if (e.kind === 'thinking' && !e.text && !e.redacted) c.emptyThinking = (c.emptyThinking ?? 0) + 1;
      else c[e.kind] = (c[e.kind] ?? 0) + 1;
    }
    return c;
  });
</script>

<svelte:window onscroll={onScroll} />

<div class="toolbar">
  <label><input type="checkbox" bind:checked={filters.tools} /> Tools <span class="faint">{counts['tool-use'] ?? 0}</span></label>
  <label><input type="checkbox" bind:checked={filters.thinking} /> Thinking <span class="faint" title="{counts.emptyThinking ?? 0} Thinking-Blöcke ohne gespeicherten Inhalt">{counts.thinking ?? 0}{counts.emptyThinking ? ` (+${counts.emptyThinking} leer)` : ''}</span></label>
  <label><input type="checkbox" bind:checked={filters.system} /> System <span class="faint">{counts.system ?? 0}</span></label>
  <label><input type="checkbox" bind:checked={filters.attachments} /> Anhänge <span class="faint">{counts.attachment ?? 0}</span></label>
  <label><input type="checkbox" bind:checked={filters.meta} /> Zustand <span class="faint">{counts.meta ?? 0}</span></label>
  {#if counts.unknown}<span class="badge error">{counts.unknown} unbekannt</span>{/if}
  <input type="search" placeholder="Im Verlauf suchen …" bind:value={query} />
</div>

{#if error}<p class="badge error">{error}</p>{/if}
{#if loading}
  <p class="muted">Lade Transcript …</p>
{:else}
  {#if items.length > shown}
    <div class="older"><button class="btn" onclick={() => (shown += WINDOW)}>Ältere anzeigen ({items.length - shown} ausgeblendet)</button></div>
  {/if}
  <div class="entries">
    {#each visible as it (it.key)}
      <div id="e-{it.key}" class="item" class:focused={focusKey === it.key}>
        {#if 'use' in it}
          <ToolCall
            use={it.use}
            result={it.result}
            {sessionId}
            {agentId}
            subagent={subByToolUse.get(it.use.toolUseId)}
            spawned={spawnedByToolUse.get(it.use.toolUseId)}
            {live}
            initiallyOpen={focusKey === it.key}
          />
        {:else}
          <EntryView e={it.e} {sessionId} {agentId} />
        {/if}
      </div>
    {/each}
  </div>
  {#if items.length === 0}<p class="muted">Keine Einträge{query ? ' für diese Suche' : ''}.</p>{/if}
  {#if live}
    <div class="follow faint">{follow ? '● folgt live' : 'Live-Updates – nach unten scrollen zum Folgen'}</div>
  {/if}
{/if}

<style>
  .toolbar {
    position: sticky;
    top: 52px;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;
    padding: 8px 0 10px;
    margin-bottom: 6px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    user-select: none;
  }
  .toolbar input[type='search'] {
    margin-left: auto;
    width: min(260px, 100%);
    padding: 3px 9px;
  }
  .entries {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .item.focused {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 8px;
  }
  .older {
    text-align: center;
    margin: 6px 0 12px;
  }
  .follow {
    text-align: center;
    font-size: 12px;
    padding: 14px 0;
  }
</style>
