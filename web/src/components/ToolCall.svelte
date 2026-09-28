<script lang="ts">
  import type { SpawnedSession, SubagentInfo, ToolResultEntry, ToolUseEntry } from '$shared/types';
  import { splitMcpName, toolSummary } from '$shared/tools';
  import { duration, time, toMs } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { showRaw } from '../lib/raw.svelte';
  import { href } from '../lib/router.svelte';
  import JsonView from './JsonView.svelte';
  import SpawnBadge from './SpawnBadge.svelte';
  import StatusDot from './StatusDot.svelte';
  import { rendererFor } from './tools';

  let {
    use,
    result,
    sessionId,
    agentId,
    subagent,
    spawned,
    live,
    initiallyOpen = false,
  }: {
    use: ToolUseEntry;
    result?: ToolResultEntry;
    sessionId: string;
    agentId?: string;
    subagent?: SubagentInfo;
    spawned?: SpawnedSession[];
    live: boolean;
    initiallyOpen?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(initiallyOpen);
  const mcp = $derived(splitMcpName(use.name));
  const status = $derived(!result ? (live ? 'pending' : 'open') : result.denied ? 'denied' : result.isError ? 'error' : 'ok');
  const took = $derived.by(() => {
    const a = toMs(use.timestamp);
    const b = toMs(result?.timestamp);
    if (a === undefined) return '';
    if (b !== undefined) return duration(b - a);
    return live ? duration(clock.now - a) : '';
  });
  const Renderer = $derived(rendererFor(use.name));
  const statusLabel: Record<string, string> = { pending: 'läuft', open: 'ohne Ergebnis', denied: 'abgelehnt', error: 'Fehler', ok: '' };
</script>

<div class="tool {status}" class:open>
  <button class="row" onclick={() => (open = !open)}>
    <span class="chev">{open ? '▾' : '▸'}</span>
    {#if mcp.server}<span class="server">{mcp.server}</span>{/if}
    <span class="name">{mcp.tool}</span>
    <span class="summary ellipsis">{toolSummary(use.name, use.input)}</span>
    {#if spawned?.length}
      <span class="spawn-hint" title="startet eine eigene Claude-Sitzung">⇢ {spawned.map((c) => c.agent ?? 'claude').join(', ')}</span>
    {/if}
    {#if statusLabel[status]}<span class="st">{statusLabel[status]}{status === 'denied' && result?.denied ? ` (${result.denied})` : ''}</span>{/if}
    <span class="took">{took}</span>
    <span class="ts">{time(use.timestamp)}</span>
  </button>
  {#if open}
    <div class="body">
      {#if spawned?.length}
        <div class="spawns">
          {#each spawned as c (c.childSessionId)}
            <a class="spawn" class:finished={c.status === 'done'} href={href.session(c.childSessionId)}>
              <StatusDot state={c.status === 'running' ? 'running' : c.status === 'idle' ? 'idle' : 'done'} size={7} />
              <strong>{c.agent ?? 'claude'}</strong>
              <span class="ellipsis">{c.title ?? c.childSessionId}</span>
              <SpawnBadge link={c} />
              <span class="open">Sitzung öffnen →</span>
            </a>
          {/each}
        </div>
      {/if}
      <Renderer {use} {result} {sessionId} {subagent} />
      <div class="foot">
        {#if use.extra}<JsonView value={use.extra} label="weitere Felder (Aufruf)" />{/if}
        {#if result?.extra}<JsonView value={result.extra} label="weitere Felder (Ergebnis)" />{/if}
        <span class="spacer"></span>
        <span class="faint mono small">{use.toolUseId}</span>
        <button class="icon-btn" title="Rohdaten Aufruf" onclick={() => showRaw(sessionId, agentId, use.line)}>{'{ }'} Aufruf</button>
        {#if result}<button class="icon-btn" title="Rohdaten Ergebnis" onclick={() => showRaw(sessionId, agentId, result!.line)}>{'{ }'} Ergebnis</button>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .tool {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  .tool.error {
    border-color: color-mix(in srgb, var(--error) 45%, var(--border));
  }
  .tool.pending {
    border-color: color-mix(in srgb, var(--busy) 55%, var(--border));
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 5px 10px;
    border: none;
    background: none;
    text-align: left;
    min-width: 0;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .chev {
    flex: none;
    width: 10px;
    color: var(--faint);
    font-size: 11px;
  }
  .server {
    flex: none;
    font-size: 11px;
    color: var(--faint);
    font-family: var(--mono);
  }
  .name {
    flex: none;
    font-family: var(--mono);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
  }
  .summary {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--text);
  }
  .spawn-hint {
    flex: none;
    font-size: 11.5px;
    color: var(--info);
  }
  .spawns {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .spawn {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 10px;
    border-radius: 7px;
    background: var(--info-soft);
    color: var(--text);
    font-size: 13px;
    text-decoration: none;
  }
  .spawn.finished {
    background: var(--surface-2);
    color: var(--muted);
  }
  .spawn .open {
    margin-left: auto;
    flex: none;
    color: var(--accent);
  }
  .st {
    flex: none;
    font-size: 11.5px;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .error .st,
  .denied .st {
    background: var(--error-soft);
    color: var(--error);
  }
  .pending .st {
    background: color-mix(in srgb, var(--busy) 18%, transparent);
    color: var(--busy);
  }
  .took,
  .ts {
    flex: none;
    font-size: 11.5px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .ts {
    width: 58px;
    text-align: right;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px 10px 28px;
    border-top: 1px solid var(--border);
  }
  .foot {
    display: flex;
    gap: 10px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: 11px;
  }
  @media (max-width: 640px) {
    .ts,
    .server {
      display: none;
    }
  }
</style>
