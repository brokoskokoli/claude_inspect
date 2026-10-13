import { PLANS, type Plan, type PlanKey } from '$shared/budget';
import { live } from './live.svelte';

/** 'auto' = Tarif aus ~/.claude.json, 'off' = keine Budget-Anzeige */
export type PlanChoice = 'auto' | 'off' | PlanKey;

const KEY = 'claude-inspect.budget';

interface Stored {
  choice: PlanChoice;
  /** eigene Werte statt der kalibrierten, je Tarif */
  custom: Partial<Record<PlanKey, { weekUSD?: number; sessionUSD?: number }>>;
}

function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    const choice = v?.choice && (v.choice === 'auto' || v.choice === 'off' || v.choice in PLANS) ? v.choice : 'auto';
    return { choice, custom: v?.custom ?? {} };
  } catch {
    return { choice: 'auto', custom: {} };
  }
}

export const budget = $state<Stored>(load());

export function saveBudget(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(budget));
  } catch {
    /* private mode etc. – the choice then only lasts for this page view */
  }
}

export interface ActivePlan extends Plan {
  key: PlanKey;
  auto: boolean;
  custom: boolean;
}

/** Aktiver Tarif mit gegebenenfalls eigenen Werten, oder undefined (aus / nicht erkannt). */
export function activePlan(): ActivePlan | undefined {
  const key = budget.choice === 'auto' ? live.dashboard?.plan : budget.choice === 'off' ? undefined : budget.choice;
  if (!key) return undefined;
  const c = budget.custom[key] ?? {};
  return {
    ...PLANS[key],
    key,
    weekUSD: c.weekUSD || PLANS[key].weekUSD,
    sessionUSD: c.sessionUSD || PLANS[key].sessionUSD,
    auto: budget.choice === 'auto',
    custom: !!(c.weekUSD || c.sessionUSD),
  };
}

export function pct(usd: number, of: number): string {
  const p = (usd / of) * 100;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)} %`;
}
