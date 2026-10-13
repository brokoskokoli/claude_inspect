<script lang="ts">
  import { ASPECTS, REVIEW_MODELS, type ReviewRun, type ReviewState } from '$shared/review';
  import { api } from '../lib/api';
  import { dateTime, duration, usd } from '../lib/format';
  import { clock } from '../lib/live.svelte';
  import { markdown } from '../lib/markdown';

  let { review, onanalyze }: { review: ReviewState | null; onanalyze: () => void } = $props();

  const label = (k: string) => ASPECTS.find((a) => a.key === k)?.label ?? k;
  const modelLabel = (k: string) => REVIEW_MODELS.find((m) => m.key === k)?.label.split(' –')[0] ?? k;
  const STATUS = { running: 'running', done: 'done', error: 'failed', cancelled: 'cancelled' } as const;

  async function cancel(run: ReviewRun) {
    try {
      await api.cancelReview(run.id);
    } catch {
      /* schon beendet */
    }
  }
  function copy(run: ReviewRun) {
    void navigator.clipboard?.writeText(run.text);
  }
</script>

{#if !review}
  <p class="muted">Loading …</p>
{:else if review.disabled}
  <p class="muted">Analysis is turned off for this claude-inspect instance (<code>--no-analyze</code>).</p>
{:else if review.runs.length === 0}
  <div class="card empty">
    <p><strong>No analysis yet.</strong></p>
    <p class="muted">
      Let Claude review this session: did it do what was asked, was it efficient, were secrets or personal data exposed, which risky commands ran, and what to change in your
      setup next time.
    </p>
    <button class="btn primary" onclick={onanalyze} disabled={!review.available}>✦ Analyze with Claude</button>
    {#if !review.available}<p class="faint small">The <code>claude</code> command was not found on this machine.</p>{/if}
  </div>
{:else}
  <div class="toolbar">
    <span class="muted">{review.runs.length} {review.runs.length === 1 ? 'analysis' : 'analyses'} · stored in claude-inspect's data directory</span>
    <button class="btn primary" onclick={onanalyze} disabled={!review.available}>✦ New analysis</button>
  </div>
  {#each review.runs as run, i (run.id)}
    <details class="card run" open={i === 0}>
      <summary>
        <span class="status {run.status}">{STATUS[run.status]}</span>
        <span>{dateTime(run.startedAt)}</span>
        <span class="faint">{modelLabel(run.request.model)}</span>
        <span class="chips">
          {#each run.request.aspects as a (a)}<span class="chip">{label(a)}</span>{/each}
          {#if run.request.question}<span class="chip">own question</span>{/if}
        </span>
        <span class="meta faint">
          {#if run.status === 'running'}{duration(clock.now - Date.parse(run.startedAt))}{:else if run.finishedAt}{duration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}{/if}
          {#if run.costUSD !== undefined} · {run.costUSD < 0.01 ? '< $0.01' : usd(run.costUSD)}{/if}
        </span>
      </summary>
      <div class="body">
        {#if run.request.question}<p class="question"><span class="faint">Your question:</span> {run.request.question}</p>{/if}
        {#if run.error}<p class="badge error">{run.error}</p>{/if}
        {#if run.text}
          <div class="md">{@html markdown(run.text)}</div>
        {:else if run.status === 'running'}
          <p class="muted">Claude is reading the session ({run.digest.tokens.toLocaleString('en-US')} tokens) …</p>
        {/if}
        <div class="foot">
          {#if run.status === 'running'}
            <span class="pulse" aria-hidden="true"></span>
            <button class="btn" onclick={() => cancel(run)}>Stop</button>
          {:else if run.text}
            <button class="btn" onclick={() => copy(run)}>Copy as Markdown</button>
          {/if}
          <span class="faint small">
            digest: {run.digest.toolCalls} tool calls, {run.digest.agents} agents{run.digest.truncated ? ', shortened' : ''}{run.digest.redactions ? `, ${run.digest.redactions} secrets masked` : ''}{run.modelId ? ` · ${run.modelId}` : ''}
          </span>
        </div>
      </div>
    </details>
  {/each}
{/if}

<style>
  .empty {
    padding: 22px;
    max-width: 640px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .empty p {
    margin: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 12.5px;
  }
  .toolbar .btn {
    margin-left: auto;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .btn.primary:disabled {
    opacity: 0.5;
  }
  .run {
    margin-bottom: 12px;
    padding: 0;
    max-width: 980px;
  }
  summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 10px 14px;
    cursor: pointer;
    font-size: 13px;
  }
  .status {
    font-size: 11.5px;
    font-weight: 600;
    padding: 1px 8px;
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .status.running {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .status.done {
    background: var(--info-soft);
    color: var(--info);
  }
  .status.error {
    background: var(--error-soft);
    color: var(--error);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    font-size: 11.5px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 9px;
    color: var(--muted);
  }
  .meta {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .body {
    padding: 4px 18px 14px;
    border-top: 1px solid var(--border);
  }
  .question {
    font-size: 13px;
    margin: 10px 0 0;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }
  .small {
    font-size: 12px;
  }
  .pulse {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
  .md {
    font-size: 14px;
    line-height: 1.55;
  }
  .md :global(p) {
    margin: 0 0 4px;
  }
  .md :global(.md-gap) {
    height: 6px;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 2px 0 6px;
    padding-left: 22px;
  }
  .md :global(li) {
    margin: 3px 0;
  }
  .md :global(code) {
    background: var(--code-bg);
    padding: 0 4px;
    border-radius: 4px;
    font-size: 12.5px;
  }
  .md :global(.md-code) {
    background: var(--code-bg);
    padding: 8px 10px;
    border-radius: 6px;
    margin: 4px 0;
    overflow: auto;
    font-size: 12.5px;
  }
  .md :global(.md-h) {
    font-weight: 650;
    margin: 14px 0 4px;
  }
  .md :global(.md-h1),
  .md :global(.md-h2) {
    font-size: 15.5px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--border);
  }
  .md :global(.md-table) {
    border-collapse: collapse;
    margin: 4px 0;
    font-size: 13px;
  }
  .md :global(.md-table td),
  .md :global(.md-table th) {
    border: 1px solid var(--border);
    padding: 2px 8px;
    text-align: left;
    vertical-align: top;
  }
</style>
