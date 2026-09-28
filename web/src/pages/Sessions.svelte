<script lang="ts">
  import type { SessionSummary } from '$shared/types';
  import SessionTable from '../components/SessionTable.svelte';
  import { api } from '../lib/api';

  const PAGE = 60;
  let q = $state('');
  let items = $state<SessionSummary[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load(reset: boolean) {
    loading = true;
    try {
      const r = await api.sessions(reset ? 0 : items.length, PAGE, q.trim());
      items = reset ? r.items : [...items, ...r.items];
      total = r.total;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void q;
    clearTimeout(timer);
    timer = setTimeout(() => load(true), 200);
  });
</script>

<div class="head">
  <h2>Sessions</h2>
  <span class="muted">{total} transcripts</span>
  <input type="search" placeholder="Project, title, prompt, session id …" bind:value={q} />
</div>

<div class="card"><SessionTable sessions={items} /></div>

{#if items.length < total}
  <div class="more"><button class="btn" disabled={loading} onclick={() => load(false)}>{loading ? 'Loading …' : `Load more (${total - items.length})`}</button></div>
{/if}

<style>
  .head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 12px;
  }
  input {
    margin-left: auto;
    width: min(360px, 50vw);
  }
  .more {
    text-align: center;
    margin-top: 14px;
  }
</style>
