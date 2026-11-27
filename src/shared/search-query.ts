/**
 * Suchanfrage: Wörter müssen im selben Eintrag stehen (Prompt, Antwort, Thinking, Tool-Aufruf,
 * Tool-Ergebnis), in beliebiger Reihenfolge. "…" ist eine Phrase, die genau so vorkommen muss.
 * `~N` erweitert das auf N aufeinanderfolgende Einträge des Transcripts. Groß-/Kleinschreibung
 * und Art und Anzahl von Leerzeichen spielen nirgends eine Rolle. Ab drei Begriffen zählen auch
 * Treffer, in denen nur ein Teil steht (siehe `min`) – sie stehen in der Rangfolge weiter hinten.
 */
export interface SearchQuery {
  /** klein geschrieben, Leerraum zu einem Leerzeichen zusammengefasst; ohne doppelte */
  terms: string[];
  /** in wie vielen aufeinanderfolgenden Einträgen die Begriffe stehen müssen (≥ 1) */
  window: number;
  /** so viele Begriffe muss ein Treffer mindestens enthalten */
  min: number;
  /** alle Begriffe in der eingegebenen Reihenfolge hintereinander: wortwörtlicher Treffer */
  literal: string;
}

const MAX_WINDOW = 100;

export function parseQuery(query: string): SearchQuery {
  const terms: string[] = [];
  let window = 1;
  const add = (t: string) => {
    t = t.replace(/[\s\u001e\u001f]+/g, ' ').trim().toLowerCase();
    if (t && !terms.includes(t)) terms.push(t);
  };
  // "Phrase" (ohne schließendes Anführungszeichen bis zum Ende), sonst einzelne Wörter
  for (const m of query.matchAll(/"([^"]*)"?|(\S+)/g)) {
    if (m[2] === undefined) add(m[1]);
    else if (/^~\d+$/.test(m[2])) window = Math.min(MAX_WINDOW, Math.max(1, Number(m[2].slice(1))));
    else add(m[2].replace(/"/g, ''));
  }
  // zwei Begriffe: beide (sonst wäre es eine Suche nach einem Wort); drei: zwei; vier: drei; …
  const min = terms.length <= 2 ? terms.length : Math.ceil((terms.length * 2) / 3);
  return { terms, window, min, literal: terms.join(' ') };
}

/** Zu kurz zum Suchen: kein Begriff mit mindestens zwei Zeichen */
export function tooShort(q: SearchQuery): boolean {
  return !q.terms.some((t) => t.length >= 2);
}

/** Fundstelle eines Begriffs (Index in `terms`) in einem Text */
export interface Pos {
  at: number;
  t: number;
  len: number;
}

/** Was einen Treffer ausmacht; daraus berechnet `score` die Rangfolge. */
export interface MatchFacts {
  /** wie viele verschiedene Begriffe getroffen sind */
  matched: number;
  /** über wie viele Einträge der Treffer reicht (1 = ein Eintrag) */
  span: number;
  /** Fundstellen insgesamt */
  occurrences: number;
  /** alle Begriffe stehen in der eingegebenen Reihenfolge direkt hintereinander */
  phrase: boolean;
  /** Zeichen zwischen den Begriffen im kürzesten Ausschnitt, der alle enthält (nur in einem Eintrag) */
  gap?: number;
}

export type MatchSource = 'name' | 'file' | 'text';

/**
 * Rangfolge eines Treffers, höher ist besser. Vor allem zählt der Anteil getroffener Begriffe,
 * danach: Name vor Dateiname vor Text, wortwörtlich, in wie wenigen Einträgen, wie nah
 * beieinander, wie oft.
 */
export function score(q: SearchQuery, f: MatchFacts, source: MatchSource): number {
  const coverage = Math.round((f.matched / Math.max(1, q.terms.length)) * 100);
  let rest = source === 'name' ? 3000 : source === 'file' ? 1500 : 0;
  if (f.phrase && q.terms.length > 1) rest += 2000;
  rest += 1500 / f.span;
  rest += f.gap === undefined ? (f.span > 1 ? 0 : 1000) : 1000 / (1 + f.gap / 40);
  rest += Math.min(1000, 250 * Math.log2(1 + f.occurrences));
  return coverage * 10_000 + Math.round(rest);
}

/** Kürzester Bereich, der von jedem vorkommenden Begriff eine Fundstelle enthält. `pos` sortiert nach `at`. */
export function tightest(pos: Pos[]): { start: number; end: number; gap: number } | undefined {
  if (!pos.length) return undefined;
  const need = new Set(pos.map((p) => p.t)).size;
  const count = new Map<number, number>();
  let best: { start: number; end: number; gap: number } | undefined;
  for (let i = 0, j = 0; j < pos.length; j++) {
    count.set(pos[j].t, (count.get(pos[j].t) ?? 0) + 1);
    while (count.size === need) {
      let end = 0;
      const lens = new Map<number, number>();
      for (let k = i; k <= j; k++) {
        end = Math.max(end, pos[k].at + pos[k].len);
        lens.set(pos[k].t, Math.max(lens.get(pos[k].t) ?? 0, pos[k].len));
      }
      let terms = 0;
      for (const l of lens.values()) terms += l;
      const gap = Math.max(0, end - pos[i].at - terms);
      if (!best || gap < best.gap) best = { start: pos[i].at, end, gap };
      const c = count.get(pos[i].t)! - 1;
      if (c) count.set(pos[i].t, c);
      else count.delete(pos[i].t);
      i++;
    }
  }
  return best;
}

/** Fundstellen aller Begriffe in einem Text (Text klein geschrieben, Leerraum zusammengefasst). */
export function positions(text: string, q: SearchQuery, cap = 200): Pos[] {
  const out: Pos[] = [];
  q.terms.forEach((term, t) => {
    let n = 0;
    for (let i = text.indexOf(term); i >= 0 && n < cap; i = text.indexOf(term, i + term.length), n++) out.push({ at: i, t, len: term.length });
  });
  return out.sort((a, b) => a.at - b.at);
}

/** Treffer in einem einzelnen Text (Name, Pfad, Prompt der Historie) – oder undefined, wenn zu wenige Begriffe drinstehen. */
export function matchText(text: string, q: SearchQuery): (MatchFacts & { pos: Pos[] }) | undefined {
  const pos = positions(text, q);
  const matched = new Set(pos.map((p) => p.t)).size;
  if (!matched || matched < q.min) return undefined;
  return {
    matched,
    span: 1,
    occurrences: pos.length,
    phrase: matched === q.terms.length && text.includes(q.literal),
    gap: matched > 1 ? tightest(pos)?.gap : undefined,
    pos,
  };
}

/**
 * Ausschnitt, der die Fundstellen zeigt: ein Stück, wenn sie nah beieinander liegen, sonst
 * mehrere, mit „…“ verbunden.
 */
export function fragments(text: string, at: { at: number; len: number }[], radius = 70, max = 4): string {
  if (!at.length) return text.slice(0, radius * 2);
  const ranges: [number, number][] = [];
  for (const p of [...at].sort((a, b) => a.at - b.at)) {
    const s = Math.max(0, p.at - radius);
    const e = Math.min(text.length, p.at + p.len + radius);
    const last = ranges[ranges.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else if (ranges.length < max) ranges.push([s, e]);
  }
  return ranges.map(([s, e], i) => (s > 0 || i > 0 ? '…' : '') + text.slice(s, e) + (i === ranges.length - 1 && e < text.length ? '…' : '')).join(' ');
}
