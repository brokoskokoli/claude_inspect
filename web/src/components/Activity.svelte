<script lang="ts">
  import type { ActivityInfo } from '$shared/types';
  import { splitMcpName } from '$shared/tools';
  import { duration, toMs } from '../lib/format';
  import { clock } from '../lib/live.svelte';

  let { activity }: { activity: ActivityInfo | null | undefined } = $props();

  const icons: Record<ActivityInfo['kind'], string> = {
    tool: '⚙',
    thinking: '💭',
    text: '✎',
    waiting: '⋯',
    idle: '◌',
    error: '⚠',
  };
  const since = $derived(toMs(activity?.since));
</script>

{#if activity}
  <div class="act {activity.kind}">
    <span class="icon">{icons[activity.kind]}</span>
    {#if activity.toolName}<span class="tool">{splitMcpName(activity.toolName).tool}</span>{/if}
    <span class="label">{activity.label}</span>
    {#if since && activity.kind !== 'idle'}<span class="since">{duration(clock.now - since)}</span>{/if}
  </div>
{/if}

<style>
  .act {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
    font-size: 13px;
  }
  .icon {
    flex: none;
    width: 16px;
    text-align: center;
    color: var(--muted);
  }
  .tool {
    flex: none;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .since {
    flex: none;
    margin-left: auto;
    font-size: 12px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .idle .label {
    color: var(--muted);
  }
  .error {
    color: var(--error);
  }
  .thinking .label {
    font-style: italic;
    color: var(--muted);
  }
</style>
