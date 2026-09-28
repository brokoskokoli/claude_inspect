import { open, stat } from 'node:fs/promises';

export interface JsonlLine {
  /** 0-basierte Zeilennummer. */
  line: number;
  /** Byte-Offset des Zeilenanfangs. */
  offset: number;
  value?: unknown;
  error?: string;
}

function parseLine(text: string, line: number, offset: number): JsonlLine {
  try {
    return { line, offset, value: JSON.parse(text) };
  } catch (e) {
    return { line, offset, error: (e as Error).message };
  }
}

/**
 * Liest eine wachsende JSONL-Datei inkrementell: Jeder Aufruf von readNew()
 * liefert nur die seitdem vollständig geschriebenen Zeilen.
 */
export class JsonlTail {
  offset = 0;
  lineNo = 0;
  private leftover: Buffer = Buffer.alloc(0);

  constructor(readonly path: string) {}

  /**
   * @param prefilter Optional: nur Zeilen parsen, deren Rohtext passt (spart bei
   *                  großen Dateien den Großteil der JSON.parse-Arbeit).
   */
  async readNew(prefilter?: (text: string) => boolean): Promise<{ lines: JsonlLine[]; reset: boolean }> {
    const st = await stat(this.path);
    let reset = false;
    if (st.size < this.offset) {
      // Datei wurde gekürzt oder ersetzt → von vorn.
      this.offset = 0;
      this.lineNo = 0;
      this.leftover = Buffer.alloc(0);
      reset = true;
    }
    if (st.size === this.offset) return { lines: [], reset };

    const fh = await open(this.path, 'r');
    try {
      const len = st.size - this.offset;
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, this.offset);
      const chunk = Buffer.concat([this.leftover, buf.subarray(0, bytesRead)]);
      const chunkStart = this.offset - this.leftover.length;
      this.offset += bytesRead;

      const lines: JsonlLine[] = [];
      let start = 0;
      for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, start)) {
        const text = chunk.toString('utf8', start, i);
        if (text.trim() && (!prefilter || prefilter(text))) lines.push(parseLine(text, this.lineNo, chunkStart + start));
        this.lineNo++;
        start = i + 1;
      }
      this.leftover = Buffer.from(chunk.subarray(start));
      return { lines, reset };
    } finally {
      await fh.close();
    }
  }
}

/** Liest nur Anfang und Ende einer Datei – für schnelle Zusammenfassungen. */
export async function readHeadTail(
  path: string,
  headBytes: number,
  tailBytes: number,
): Promise<{ head: unknown[]; tail: unknown[]; size: number }> {
  const st = await stat(path);
  const fh = await open(path, 'r');
  try {
    const parse = (buf: Buffer, dropFirst: boolean, dropLast: boolean): unknown[] => {
      const parts = buf.toString('utf8').split('\n');
      if (dropFirst) parts.shift();
      if (dropLast) parts.pop();
      const out: unknown[] = [];
      for (const p of parts) {
        if (!p.trim()) continue;
        try {
          out.push(JSON.parse(p));
        } catch {
          /* angeschnittene Zeile */
        }
      }
      return out;
    };
    if (st.size <= headBytes + tailBytes) {
      const buf = Buffer.alloc(st.size);
      await fh.read(buf, 0, st.size, 0);
      const all = parse(buf, false, false);
      return { head: all, tail: all, size: st.size };
    }
    const hb = Buffer.alloc(headBytes);
    await fh.read(hb, 0, headBytes, 0);
    const tb = Buffer.alloc(tailBytes);
    await fh.read(tb, 0, tailBytes, st.size - tailBytes);
    return { head: parse(hb, false, true), tail: parse(tb, true, false), size: st.size };
  } finally {
    await fh.close();
  }
}

/** Liest eine einzelne Zeile ab einem bekannten Byte-Offset. */
export async function readLineAt(path: string, offset: number, maxBytes: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, offset);
    const end = buf.subarray(0, bytesRead).indexOf(10);
    return buf.toString('utf8', 0, end === -1 ? bytesRead : end);
  } finally {
    await fh.close();
  }
}

export async function readJson(path: string): Promise<unknown> {
  const fh = await open(path, 'r');
  try {
    return JSON.parse(await fh.readFile('utf8'));
  } finally {
    await fh.close();
  }
}
