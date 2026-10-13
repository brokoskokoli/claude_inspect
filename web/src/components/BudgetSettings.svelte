<script lang="ts">
  import { BUDGET_CALIBRATED, PLANS, type PlanKey } from '$shared/budget';
  import { activePlan, budget, saveBudget, type PlanChoice } from '../lib/budget.svelte';
  import { live } from '../lib/live.svelte';

  const detected = $derived(live.dashboard?.plan);
  const plan = $derived(activePlan());
  let open = $state(false);

  function setChoice(v: PlanChoice) {
    budget.choice = v;
    saveBudget();
  }
  function setCustom(key: PlanKey, field: 'weekUSD' | 'sessionUSD', v: string) {
    const n = Number(v);
    budget.custom[key] = { ...budget.custom[key], [field]: n > 0 ? n : undefined };
    saveBudget();
  }
  function reset(key: PlanKey) {
    delete budget.custom[key];
    saveBudget();
  }
</script>

<span class="budget">
  <label>
    Budget
    <select value={budget.choice} onchange={(e) => setChoice(e.currentTarget.value as PlanChoice)}>
      <option value="auto">Auto{detected ? ` (${PLANS[detected].label})` : ' (not detected)'}</option>
      {#each Object.entries(PLANS) as [k, p] (k)}<option value={k}>{p.label}</option>{/each}
      <option value="off">Off</option>
    </select>
  </label>
  {#if plan}
    <button class="icon-btn" aria-expanded={open} onclick={() => (open = !open)} title="Budget values">{open ? '▾' : '▸'} ${plan.weekUSD.toLocaleString('en-US')}/week{plan.custom ? ' (custom)' : ''}</button>
  {/if}
</span>

{#if open && plan}
  <div class="panel card">
    <p class="faint small">
      Claude plans have no published token or dollar limits. These values are the API list-price equivalent of a full limit,
      calibrated from real <code>/usage</code> readings on {BUDGET_CALIBRATED}{plan.measured ? '' : ' – for this plan extrapolated from the published ratios between plans, not measured'}.
      Usage on claude.ai or other machines also counts towards the limit.
    </p>
    <div class="fields">
      <label>Week (100 %) $<input type="number" min="1" step="10" value={plan.weekUSD} onchange={(e) => setCustom(plan.key, 'weekUSD', e.currentTarget.value)} /></label>
      <label>5-hour window (100 %) $<input type="number" min="1" step="5" value={plan.sessionUSD} onchange={(e) => setCustom(plan.key, 'sessionUSD', e.currentTarget.value)} /></label>
      {#if plan.custom}<button class="btn" onclick={() => reset(plan.key)}>Reset to calibrated</button>{/if}
    </div>
  </div>
{/if}

<style>
  .budget {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  select {
    font-size: 12.5px;
    padding: 1px 4px;
  }
  .icon-btn {
    font-size: 12px;
  }
  .panel {
    flex-basis: 100%;
    padding: 10px 14px;
    margin-top: 4px;
  }
  .panel p {
    margin: 0 0 8px;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    align-items: center;
  }
  .fields input {
    width: 90px;
    padding: 2px 6px;
  }
  .small {
    font-size: 12px;
  }
</style>
