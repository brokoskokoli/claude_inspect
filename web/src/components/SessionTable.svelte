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
        <th>Project</th>
        <th>Title / last prompt</th>
        <th>Last active</th>
        <th class="hide-s">Model</th>
        <th class="hide-s num">Subagents</th>
        <th class="hide-s num">Size</th>
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
            <div class="ellipsis">{#if s.spawnedBy}<span class="spawned" title="started by another session via a claude call">↳</span>{/if}{s.title ?? s.sessionId}</div>
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
  /* phones: each session as a compact two-line entry (project · last active / title) */
  @media (max-width: 640px) {
    thead {
      display: none;
    }
    table,
    tbody {
      display: block;
    }
    tr {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      grid-template-areas:
        'dot proj when'
        '. title title';
      column-gap: 6px;
      row-gap: 2px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    tr:last-child {
      border-bottom: none;
    }
    table.list td {
      display: block;
      padding: 0;
      border: none;
    }
    table.list td.hide-s {
      display: none;
    }
    .dot {
      grid-area: dot;
      width: auto;
      padding-top: 1px !important;
    }
    .proj {
      grid-area: proj;
      display: flex;
      gap: 8px;
      align-items: baseline;
      min-width: 0;
      overflow: hidden;
    }
    .title {
      grid-area: title;
      max-width: none;
      width: auto;
      min-width: 0;
    }
    .when {
      grid-area: when;
      font-size: 13px;
    }
  }
</style>
