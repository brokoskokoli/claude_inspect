import type { Usage } from './types.js';

/**
 * API-Listenpreise in USD pro 1 Mio. Tokens (Anthropic first-party, Stand 2026-06).
 * Dient nur als Schätzung "API-Gegenwert" – bei Abo-Nutzung zahlt man diese Beträge nicht direkt.
 * Cache-Schreiben: 1,25× (5 min) bzw. 2× (1 h) Input; Cache-Lesen: 0,1× Input,
 * sofern unten nicht explizit anders angegeben.
 */
interface Price {
  input: number;
  output: number;
  cacheRead?: number;
}

const PRICES: [prefix: string, price: Price][] = [
  // Reihenfolge: spezifischere Präfixe zuerst
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50 }],
  ['claude-mythos-5', { input: 10, output: 50 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25 }],
  ['claude-opus-4-8', { input: 5, output: 25 }],
  ['claude-opus-4-7', { input: 5, output: 25 }],
  ['claude-opus-4-6', { input: 5, output: 25 }],
  ['claude-opus-4-5', { input: 5, output: 25 }],
  ['claude-sonnet-5', { input: 2, output: 10 }],
  ['claude-sonnet-4', { input: 3, output: 15 }],
  ['claude-haiku-4-5', { input: 1, output: 5 }],
];

export function priceFor(model: string | undefined): Price | undefined {
  if (!model) return undefined;
  return PRICES.find(([p]) => model === p || model.startsWith(p + '-') || model.startsWith(p + '['))?.[1];
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  requests: number;
}

export const emptyTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, requests: 0 });

export function addUsage(t: TokenTotals, u: Usage): void {
  t.input += u.input_tokens ?? 0;
  t.output += u.output_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  const cc = u.cache_creation as { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | undefined;
  if (cc && (cc.ephemeral_1h_input_tokens !== undefined || cc.ephemeral_5m_input_tokens !== undefined)) {
    t.cacheWrite5m += cc.ephemeral_5m_input_tokens ?? 0;
    t.cacheWrite1h += cc.ephemeral_1h_input_tokens ?? 0;
  } else {
    t.cacheWrite5m += u.cache_creation_input_tokens ?? 0;
  }
  t.requests++;
}

export function mergeTotals(a: TokenTotals, b: TokenTotals): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite5m += b.cacheWrite5m;
  a.cacheWrite1h += b.cacheWrite1h;
  a.requests += b.requests;
}

/** Geschätzte Kosten in USD, oder undefined bei unbekanntem Modell. */
export function estimateCost(model: string | undefined, t: TokenTotals): number | undefined {
  const p = priceFor(model);
  if (!p) return undefined;
  const M = 1_000_000;
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * (p.cacheRead ?? p.input * 0.1) +
      t.cacheWrite5m * p.input * 1.25 +
      t.cacheWrite1h * p.input * 2) /
    M
  );
}
