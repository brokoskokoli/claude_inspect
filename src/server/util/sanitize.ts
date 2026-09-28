import { LIMITS } from '../config.js';

const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|credential)/i;

function isSecretKey(key: string): boolean {
  // Token-*Zähler* (input_tokens, totalTokens …) sind Zahlen und bleiben sichtbar.
  return SECRET_KEY.test(key);
}

export interface SanitizeOptions {
  maxString?: number;
  /** Felder, die komplett entfernt werden (z. B. originalFile = ganzer Dateiinhalt). */
  dropKeys?: ReadonlySet<string>;
}

/**
 * Tiefe Kopie, die
 * - String-Werte unter geheimnisverdächtigen Schlüsseln maskiert,
 * - Base64-Bilddaten durch einen Platzhalter ersetzt,
 * - zu lange Strings kürzt.
 */
export function sanitize(value: unknown, opts: SanitizeOptions = {}, key = ''): unknown {
  const max = opts.maxString ?? LIMITS.maxString;
  if (typeof value === 'string') {
    if (key && isSecretKey(key)) return value ? '••••••' : value;
    if ((key === 'base64' || key === 'data') && value.length > 256 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 256))) {
      return `[base64, ${value.length} Zeichen ausgelassen]`;
    }
    if (value.length > max) return value.slice(0, max) + `\n… [${value.length - max} Zeichen gekürzt]`;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, opts));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (opts.dropKeys?.has(k)) {
        out[k] = typeof v === 'string' ? `[${v.length} Zeichen ausgelassen]` : v === null ? null : '[ausgelassen]';
        continue;
      }
      out[k] = sanitize(v, opts, k);
    }
    return out;
  }
  return value;
}

export function clip(s: string, max = LIMITS.maxString): { text: string; truncated?: number } {
  return s.length > max ? { text: s.slice(0, max), truncated: s.length - max } : { text: s };
}
