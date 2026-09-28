<script lang="ts">
  import type { SessionSummary } from '$shared/types';
  import { ago, bytes, dateTime, modelName, usd } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { href } from '../lib/router.svelte';
  import StatusDot from './StatusDot.svelte';

  let { sessions }: { sessions: SessionSummary[] } = $props();
</script>

<div class="wrap">
  <table class="list">
    <thead>
      <tr>
        <th></th>
        <th>Projekt</th>
        <th>Titel / letzter Prompt</th>
        <th>Zuletzt aktiv</th>
        <th class="hide-s">Modell</th>
        <th class="hide-s num">Subagenten</th>
        <th class="hide-s num">Größe</th>
      </tr>
    </thead>
    <tbody>
      {#each sessions as s (s.sessionId)}
        <tr class="clickable" onclick={() => (location.hash = href.session(s.sessionId))}>
          <td class="dot">{#if s.live}<StatusDot state="busy" size={8} />{/if}</td>
          <td class="proj">
            <div>{s.project}</div>
            {#if s.gitBranch}<div class="faint mono small">⎇ {s.gitBranch}</div>{/if}
          </td>
          <td class="title">
            <div class="ellipsis">{#if s.spawnedBy}<span class="spawned" title="per claude-Aufruf von einer anderen Session gestartet">↳</span>{/if}{s.title ?? s.sessionId}</div>
            {#if s.lastPrompt}<div class="ellipsis muted small">{s.lastPrompt}</div>{/if}
          </td>
          <td class="when" title={dateTime(s.lastTimestamp ?? s.mtime)}>{ago(s.lastTimestamp ?? s.mtime, clock.now)}</td>
          <td class="hide-s muted">{modelName(s.model)}{#if s.costUSD !== undefined}<div class="small">{usd(s.costUSD)}</div>{/if}</td>
          <td class="hide-s num">{s.subagentCount || ''}</td>
          <td class="hide-s num muted">{bytes(s.size)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  .dot {
    width: 18px;
    padding-right: 0;
  }
  .proj {
    white-space: nowrap;
    font-weight: 500;
  }
  .title {
    max-width: 0;
    width: 55%;
  }
  .when {
    white-space: nowrap;
    color: var(--muted);
  }
  .spawned {
    color: var(--info);
    margin-right: 5px;
  }
  .small {
    font-size: 12px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 760px) {
    .hide-s {
      display: none;
    }
  }
</style>
