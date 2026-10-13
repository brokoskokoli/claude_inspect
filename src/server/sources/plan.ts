import { readFile } from 'node:fs/promises';
import { planFromTier, type PlanKey } from '../../shared/budget.js';
import { CLAUDE_JSON } from '../config.js';

let cached: { at: number; plan?: PlanKey } | undefined;

/**
 * Abo-Tarif aus ~/.claude.json. Gelesen wird nur das Rate-Limit-Tier des Kontos,
 * alles andere aus der Datei wird verworfen. Höchstens einmal pro Minute.
 */
export async function readPlan(): Promise<PlanKey | undefined> {
  if (cached && Date.now() - cached.at < 60_000) return cached.plan;
  let plan: PlanKey | undefined;
  try {
    const account = (JSON.parse(await readFile(CLAUDE_JSON, 'utf8')) as { oauthAccount?: Record<string, unknown> }).oauthAccount;
    const tier = [account?.userRateLimitTier, account?.organizationRateLimitTier].find((t): t is string => typeof t === 'string');
    plan = planFromTier(tier);
  } catch {
    /* nicht vorhanden oder nicht lesbar */
  }
  cached = { at: Date.now(), plan };
  return plan;
}
