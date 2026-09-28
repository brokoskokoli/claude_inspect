/** Minimaler Versionsvergleich für "2.1.283"-artige Strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10));
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isNaN(pa[i]) ? 0 : (pa[i] ?? 0);
    const y = Number.isNaN(pb[i]) ? 0 : (pb[i] ?? 0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Prüft Bereiche wie ">=2.1.0", "<2.2.0", ">=2.1.0 <2.2.0" oder "*".
 * Ein fehlendes `version` passt auf jeden Bereich (ältere Records hatten nicht immer eins).
 */
export function inRange(version: string | undefined, range: string | undefined): boolean {
  if (!range || range === '*' || !version) return true;
  return range.split(/\s+/).every((part) => {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(part);
    if (!m) return true;
    const c = compareVersions(version, m[2]);
    switch (m[1]) {
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  });
}
