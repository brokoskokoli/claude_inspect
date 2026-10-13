/**
 * Nutzungsbudget der Claude-Abos, ausgedrückt in API-Gegenwert (USD nach Listenpreisen, siehe pricing.ts).
 *
 * Anthropic veröffentlicht die Limits nicht in Tokens oder Dollar. Die Werte unten sind aus echten
 * `/usage`-Messwerten kalibriert (scripts/calibrate-budget.ts): Prozentwert des Limits gegen die im
 * selben Zeitraum angefallenen API-Kosten aller Rechner des Kontos. Max 20x und Max 5x sind gemessen,
 * Pro ist über die von Anthropic genannten Verhältnisse der Wochenlimits (Pro : 5x : 20x ≈ 1 : 3,5 : 6)
 * und der Session-Limits (1 : 5 : 20) hochgerechnet. Nur eine Schätzung – Nutzung über claude.ai oder
 * andere Rechner zählt ins Limit, Anthropic gewichtet Modelle und Cache vermutlich anders, und die
 * Limits ändern sich.
 */
export type PlanKey = 'max20x' | 'max5x' | 'pro';

export interface Plan {
  label: string;
  /** API-Gegenwert eines vollen Wochenlimits */
  weekUSD: number;
  /** API-Gegenwert eines vollen 5-Stunden-Fensters */
  sessionUSD: number;
  /** false = hochgerechnet statt gemessen */
  measured: boolean;
}

export const BUDGET_CALIBRATED = '2026-10-13';

export const PLANS: Record<PlanKey, Plan> = {
  max20x: { label: 'Max 20x', weekUSD: 2350, sessionUSD: 540, measured: true },
  max5x: { label: 'Max 5x', weekUSD: 1500, sessionUSD: 120, measured: true },
  pro: { label: 'Pro', weekUSD: 400, sessionUSD: 25, measured: false },
};

/** Tarif aus dem Rate-Limit-Tier in ~/.claude.json, z. B. "default_claude_max_20x". */
export function planFromTier(tier: string | undefined | null): PlanKey | undefined {
  if (!tier) return undefined;
  if (/max_20x/i.test(tier)) return 'max20x';
  if (/max_5x/i.test(tier)) return 'max5x';
  if (/pro/i.test(tier)) return 'pro';
  return undefined;
}
