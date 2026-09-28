<script lang="ts">
  import { connect, live } from './lib/live.svelte';
  import { href, router } from './lib/router.svelte';
  import { cycleTheme, theme } from './lib/theme.svelte';
  import RawModal from './components/RawModal.svelte';
  import Dashboard from './pages/Dashboard.svelte';
  import Files from './pages/Files.svelte';
  import Formats from './pages/Formats.svelte';
  import Search from './pages/Search.svelte';
  import Stats from './pages/Stats.svelte';
  import Tools from './pages/Tools.svelte';
  import Session from './pages/Session.svelte';
  import Sessions from './pages/Sessions.svelte';

  connect();

  const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' } as const;
  const running = $derived(live.dashboard?.processes.filter((p) => p.process.alive).length ?? 0);
  const r = $derived(router.route);
</script>

<header class="top">
  <a class="brand" href={href.dashboard()}>
    <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"
      ><circle cx="16" cy="16" r="11" fill="none" stroke="var(--accent)" stroke-width="4" /><circle cx="16" cy="16" r="4" fill="var(--accent)" /></svg
    >
    Claude Inspect
  </a>
  <nav>
    <a href={href.dashboard()} class:active={r.name === 'dashboard'}>Live <span class="count">{running}</span></a>
    <a href={href.sessions()} class:active={r.name === 'sessions' || r.name === 'session'}>Sessions</a>
    <a href={href.stats()} class:active={r.name === 'stats'}>Statistics</a>
    <a href={href.tools()} class:active={r.name === 'tools'}>Tools</a>
    <a href={href.files()} class:active={r.name === 'files'}>Files</a>
    <a href={href.search()} class:active={r.name === 'search'}>Search</a>
    <a href={href.formats()} class:active={r.name === 'formats'}>Formats</a>
  </nav>
  <button class="theme" onclick={cycleTheme} title="{THEME_LABEL[theme.mode]} (click to switch)" aria-label={THEME_LABEL[theme.mode]}>
    {#if theme.mode === 'light'}
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
        ><circle cx="12" cy="12" r="4.5" fill="currentColor" /><g stroke="currentColor" stroke-width="2" stroke-linecap="round"
          ><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></g
        ></svg
      >
    {:else if theme.mode === 'dark'}
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
        ><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" /></svg
      >
    {/if}
  </button>
  <span class="conn" class:ok={live.connected} title={live.connected ? 'Live connection active' : 'No connection to the server'}>
    <span class="dot"></span>{live.connected ? 'live' : 'offline'}
  </span>
</header>

<main>
  {#if r.name === 'dashboard'}
    <Dashboard />
  {:else if r.name === 'sessions'}
    <Sessions />
  {:else if r.name === 'session'}
    {#key r.id}
      <Session id={r.id} agent={r.agent} tab={r.tab} tool={r.tool} line={r.line} />
    {/key}
  {:else if r.name === 'stats'}
    <Stats />
  {:else if r.name === 'tools'}
    {#key r.params.toString()}<Tools params={r.params} />{/key}
  {:else if r.name === 'files'}
    <Files />
  {:else if r.name === 'search'}
    <Search q={r.q} />
  {:else if r.name === 'formats'}
    <Formats />
  {/if}
</main>

<RawModal />

<style>
  .top {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 28px;
    padding: 0 24px;
    height: 52px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }
  nav {
    display: flex;
    gap: 2px;
    overflow-x: auto;
    min-width: 0;
  }
  nav a {
    white-space: nowrap;
  }
  nav a {
    color: var(--muted);
    padding: 5px 12px;
    border-radius: 7px;
    text-decoration: none;
  }
  nav a:hover {
    background: var(--surface-2);
  }
  nav a.active {
    color: var(--text);
    background: var(--surface-2);
    font-weight: 500;
  }
  .count {
    display: inline-block;
    min-width: 18px;
    padding: 0 5px;
    margin-left: 2px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11.5px;
    text-align: center;
  }
  .theme {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--muted);
  }
  .theme:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .conn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--faint);
  }
  .conn .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--dead);
  }
  .conn.ok .dot {
    background: var(--busy);
  }
  main {
    padding: 20px 24px 60px;
    max-width: 1600px;
    margin: 0 auto;
  }
  @media (max-width: 640px) {
    .top {
      padding: 0 12px;
      gap: 12px;
    }
    main {
      padding: 14px 12px 40px;
    }
  }
</style>
