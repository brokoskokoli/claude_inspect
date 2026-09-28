export function toMs(t: string | number | undefined): number | undefined {
  if (t === undefined) return undefined;
  const ms = typeof t === 'number' ? t : Date.parse(t);
  return Number.isNaN(ms) ? undefined : ms;
}

export function duration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function ago(t: string | number | undefined, now: number): string {
  const ms = toMs(t);
  if (ms === undefined) return '–';
  const d = now - ms;
  if (d < 5000) return 'gerade eben';
  return `vor ${duration(d)}`;
}

export function dateTime(t: string | number | undefined): string {
  const ms = toMs(t);
  if (ms === undefined) return '–';
  return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function time(t: string | number | undefined): string {
  const ms = toMs(t);
  if (ms === undefined) return '';
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function tokens(n: number | undefined): string {
  if (n === undefined) return '–';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function usd(n: number | undefined): string {
  if (n === undefined) return '–';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortPath(p: string | undefined): string {
  if (!p) return '';
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

export function modelName(m: string | undefined): string {
  if (!m) return '–';
  return m.replace(/^claude-/, '').replace(/-(\d{8})$/, '');
}
