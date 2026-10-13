<script lang="ts">
  import Spinner from './Spinner.svelte';
  import { ASPECTS, REVIEW_MODELS, type ReviewAspect, type ReviewModel, type ReviewRun, type ReviewState } from '$shared/review';
  import { api } from '../lib/api';
  import { tokens } from '../lib/format';

  let {
    sessionId,
    agentId,
    agentLabel,
    review,
    open = $bindable(),
    onstarted,
  }: { sessionId: string; agentId?: string; agentLabel?: string; review: ReviewState | null; open: boolean; onstarted: (run: ReviewRun) => void } = $props();

  const LANGUAGES: [string, string][] = [
    ['en', 'English'],
    ['de', 'Deutsch'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['it', 'Italiano'],
    ['nl', 'Nederlands'],
    ['pl', 'Polski'],
    ['pt', 'Português'],
    ['ja', '日本語'],
    ['zh', '中文'],
  ];
  const KEY = 'claude-inspect.analyze';
  const DESCRIBE = ASPECTS.filter((a) => a.key === 'summary' || a.key === 'script');
  const REVIEW = ASPECTS.filter((a) => !DESCRIBE.includes(a));

  // Letzte Auswahl merken (nur Bequemlichkeit, darf fehlen)
  function loadPrefs(): { aspects?: ReviewAspect[]; model?: ReviewModel; language?: string } {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      return {};
    }
  }
  const prefs = loadPrefs();
  const browserLang = navigator.language.slice(0, 2).toLowerCase();
  let aspects = $state<ReviewAspect[]>(prefs.aspects ?? ASPECTS.filter((a) => a.default).map((a) => a.key));
  let model = $state<ReviewModel>(prefs.model ?? 'sonnet');
  let language = $state(prefs.language ?? (LANGUAGES.some(([k]) => k === browserLang) ? browserLang : 'en'));
  let question = $state('');
  let busy = $state(false);
  let error = $state('');

  // Für das Skript gehen vollständige Befehle und Dateiinhalte mit
  const full = $derived(aspects.includes('script'));
  const d = $derived(full ? (review?.fullDigest ?? review?.digest) : review?.digest);
  const canStart = $derived(!!review?.available && !busy && (aspects.length > 0 || question.trim().length > 0));

  function toggle(k: ReviewAspect) {
    aspects = aspects.includes(k) ? aspects.filter((a) => a !== k) : [...aspects, k];
  }

  async function start() {
    busy = true;
    error = '';
    try {
      try {
        localStorage.setItem(KEY, JSON.stringify({ aspects, model, language }));
      } catch {
        /* egal */
      }
      const run = await api.startReview(sessionId, { agentId, aspects, model, question: question.trim() || undefined, language });
      question = '';
      open = false;
      onstarted(run);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && (open = false)} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => (open = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="modal card" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="analyze-title" onclick={(e) => e.stopPropagation()}>
      <h2 id="analyze-title">Analyze with Claude</h2>
      <p class="muted intro">
        {#if agentId}Claude looks at the subagent <strong>{agentLabel ?? agentId}</strong>{:else}Claude looks at this session{/if}{d && d.agents > 1 ? ` and the ${d.agents - 1} agents it started` : ''}. Pick what you want:
      </p>

      {#each [['Describe', DESCRIBE], ['Review', REVIEW]] as const as [title, list] (title)}
        <div class="group-title">{title}</div>
        <div class="aspects">
          {#each list as a (a.key)}
            <label class="aspect" class:on={aspects.includes(a.key)}>
              <input type="checkbox" checked={aspects.includes(a.key)} onchange={() => toggle(a.key)} />
              <span>
                <strong>{a.label}</strong>
                <span class="hint">{a.hint}</span>
              </span>
            </label>
          {/each}
        </div>
      {/each}

      <label class="field">
        <span class="label">Your own question <span class="faint">(optional)</span></span>
        <textarea bind:value={question} rows="2" maxlength="2000" placeholder="e.g. Why did the tests take so long? Was the migration done safely?"></textarea>
      </label>

      <div class="row">
        <label class="field">
          <span class="label">Model</span>
          <select bind:value={model}>
            {#each REVIEW_MODELS as m (m.key)}<option value={m.key}>{m.label}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span class="label">Answer in</span>
          <select bind:value={language}>
            {#each LANGUAGES as [k, l] (k)}<option value={k}>{l}</option>{/each}
          </select>
        </label>
      </div>

      <div class="info">
        {#if !review}
          <span class="muted">Preparing the session digest …</span>
        {:else if !review.available}
          <span class="err">The <code>claude</code> command was not found on this machine, so the analysis can't run.</span>
        {:else if d}
          <span>
            Sends a {full ? 'detailed' : 'condensed'} digest of the {agentId ? 'subagent' : 'session'} (<strong>~{tokens(d.tokens)} tokens</strong>, {d.toolCalls} tool calls{full ? ' with full commands and file contents' : ''}{d.truncated ? ', shortened' : ''}{d.redactions ? `, ${d.redactions} secrets masked` : ''}) to Claude through your local <code>claude</code> CLI – no tools, not saved as a session. It counts towards your plan usage.
          </span>
          <a href={api.reviewDigestUrl(sessionId, agentId, full)} target="_blank" rel="noreferrer">View what is sent</a>
        {/if}
      </div>

      {#if error}<p class="badge error">{error}</p>{/if}

      <div class="actions">
        <button class="btn" onclick={() => (open = false)}>Cancel</button>
        <button class="btn primary" disabled={!canStart} onclick={start}>{#if busy}<Spinner /> Starting …{:else}Let's go{/if}</button>
      </div>
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
    width: min(720px, 100%);
    max-height: 100%;
    overflow-y: auto;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    font-size: 17px;
    margin: 0;
  }
  .intro {
    margin: -4px 0 0;
    font-size: 13px;
  }
  .group-title {
    font-size: 11.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--faint);
    margin-bottom: -4px;
  }
  .aspects {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    gap: 8px;
  }
  .aspect {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
  }
  .aspect.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .aspect input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  .aspect span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
  }
  .row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 180px;
  }
  .label {
    font-size: 12px;
    color: var(--muted);
  }
  textarea,
  select {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
  }
  textarea {
    resize: vertical;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
    padding: 9px 11px;
    border-radius: 8px;
    background: var(--surface-2);
  }
  .err {
    color: var(--error);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .btn.primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @media (max-width: 640px) {
    .backdrop {
      padding: 8px;
    }
  }
</style>
