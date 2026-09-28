import type { Raw } from './types.js';

export const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
export const obj = (v: unknown): Raw | undefined => (isObj(v) ? v : undefined);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Alle Felder von `raw`, die nicht in `known` stehen – oder undefined, wenn keine. */
export function extraFields(raw: Raw, known: readonly string[]): Raw | undefined {
  let out: Raw | undefined;
  for (const k of Object.keys(raw)) {
    if (!known.includes(k)) (out ??= {})[k] = raw[k];
  }
  return out;
}

export function without(raw: Raw, keys: readonly string[]): Raw {
  const out: Raw = {};
  for (const [k, v] of Object.entries(raw)) if (!keys.includes(k)) out[k] = v;
  return out;
}
