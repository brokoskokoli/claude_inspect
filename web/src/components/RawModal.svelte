<script lang="ts">
  import { rawView } from '../lib/raw.svelte';

  function close() {
    rawView.open = false;
  }
  function copy() {
    void navigator.clipboard?.writeText(JSON.stringify(rawView.data, null, 2));
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

{#if rawView.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="modal card" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <span class="mono">{rawView.title}</span>
        <span class="muted small">raw data, secrets masked</span>
        <button class="btn" onclick={copy}>Copy</button>
        <button class="btn" onclick={close}>Close</button>
      </div>
      {#if rawView.error}
        <p class="badge error">{rawView.error}</p>
      {:else if rawView.data === null}
        <p class="muted">Loading …</p>
      {:else}
        <pre>{JSON.stringify(rawView.data, null, 2)}</pre>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgb(0 0 0 / 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .modal {
    width: min(1000px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .head .mono {
    font-weight: 600;
  }
  .head .btn:first-of-type {
    margin-left: auto;
  }
  .small {
    font-size: 12px;
  }
  pre {
    overflow: auto;
    background: var(--code-bg);
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 12px;
  }
</style>
