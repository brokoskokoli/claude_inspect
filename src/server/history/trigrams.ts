/**
 * Welche Dreierfolgen von Zeichen kommen in einem Text vor? Ein Bitfeld je Indexdatei, damit
 * die Suche nur Dateien liest, in denen alle Dreierfolgen des Suchbegriffs vorkommen.
 *
 * Damit der Filter nie eine Datei mit Treffer aussortiert (die Suche selbst vergleicht
 * ohne Rücksicht auf Groß-/Kleinschreibung): ASCII-Großbuchstaben zählen als kleine, alle
 * Zeichen außerhalb von ASCII als dasselbe Zeichen. Gestreut in ein Bitfeld, das sich
 * verdoppelt, sobald mehr als ein Viertel der Bits gesetzt ist – bis es jede mögliche
 * Dreierfolge einzeln fasst.
 */

const MIN_LOG = 13; // 1 KB
/** 129³ mögliche Dreierfolgen passen in 2^22 Bits (512 KB): dann ohne Streuung, exakt */
const MAX_LOG = 22;
const FILL = 0.25;

/** Ruft `each` für jede Dreierfolge des Texts auf (als Zahl < 129³). */
export function eachTrigram(text: string, each: (code: number) => void): void {
  let a = 0;
  let b = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    else if (c > 127) c = 128;
    if (i >= 2) each((a * 129 + b) * 129 + c);
    a = b;
    b = c;
  }
}

/** Dreierfolgen eines Suchbegriffs, ohne doppelte. Leer bei weniger als drei Zeichen (dann kein Filter). */
export function queryTrigrams(needle: string): number[] {
  const set = new Set<number>();
  eachTrigram(needle, (c) => set.add(c));
  return [...set];
}

export class Trigrams {
  private bits: Uint8Array;
  private set = 0;

  constructor(
    private log = MIN_LOG,
    bits?: Uint8Array,
  ) {
    this.bits = bits && bits.length === 1 << (log - 3) ? bits : new Uint8Array(1 << (log - 3));
    if (bits) for (const byte of this.bits) for (let v = byte; v; v &= v - 1) this.set++;
  }

  /** Bitfeld zum Speichern; mit `from()` wieder einlesen */
  get bytes(): Uint8Array {
    return this.bits;
  }

  static from(bytes: Uint8Array): Trigrams | undefined {
    const log = Math.log2(bytes.length * 8);
    return Number.isInteger(log) && log >= MIN_LOG && log <= MAX_LOG ? new Trigrams(log, bytes) : undefined;
  }

  private slot(code: number): number {
    return this.log === MAX_LOG ? code : Math.imul(code, 0x9e3779b1) >>> (32 - this.log);
  }

  add(text: string): void {
    eachTrigram(text, (code) => {
      const i = this.slot(code);
      const m = 1 << (i & 7);
      if (this.bits[i >> 3] & m) return;
      this.bits[i >> 3] |= m;
      this.set++;
    });
  }

  /** Zu voll, um noch gut zu filtern: mit größerem Bitfeld neu aufbauen (siehe `grown`). */
  get full(): boolean {
    return this.log < MAX_LOG && this.set > (1 << this.log) * FILL;
  }

  /** Leeres, doppelt so großes Bitfeld */
  grown(): Trigrams {
    return new Trigrams(Math.min(MAX_LOG, this.log + 1));
  }

  /** Kann der Text alle diese Dreierfolgen enthalten? (Nein ist sicher, Ja nur wahrscheinlich.) */
  mayContain(codes: number[]): boolean {
    for (const code of codes) {
      const i = this.slot(code);
      if (!(this.bits[i >> 3] & (1 << (i & 7)))) return false;
    }
    return true;
  }
}
