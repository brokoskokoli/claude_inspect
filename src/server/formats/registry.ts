import type { DecoderInfo, DriftItem } from '../../shared/types.js';
import { compareVersions } from '../util/semver.js';
import type { Decoder, DecodeContext, Raw, SourceKind } from './types.js';
import { isObj, str } from './util.js';

interface DriftState extends DriftItem {}

export class FormatRegistry {
  private decoders = new Map<SourceKind, Decoder<unknown>[]>();
  private hits = new Map<string, number>();
  private drift = new Map<string, DriftState>();

  register<Out>(d: Decoder<Out>): this {
    const list = this.decoders.get(d.source) ?? [];
    if (list.some((x) => x.id === d.id)) throw new Error(`Decoder ${d.id} doppelt registriert`);
    list.push(d as Decoder<unknown>);
    this.decoders.set(d.source, list);
    return this;
  }

  /** Wählt den am besten passenden Decoder und dekodiert den Record. */
  decode<Out>(source: SourceKind, raw: unknown, file: string, line = 0, opts: { silent?: boolean } = {}): { out: Out; decoder: string } {
    const record: Raw = isObj(raw) ? raw : { __nonObject: raw };
    const version = str(record.version) ?? str(record.cliVersion);
    const ctx: DecodeContext = {
      source,
      file,
      line,
      reportUnknown: (recordType, o, known) => {
        if (!o) return undefined;
        let extra: Raw | undefined;
        for (const k of Object.keys(o)) {
          if (known.includes(k)) continue;
          (extra ??= {})[k] = o[k];
          if (!opts.silent) this.noteDrift(source, recordType, k, version);
        }
        return extra;
      },
    };

    let best: Decoder<unknown> | undefined;
    let bestScore = 0;
    for (const d of this.decoders.get(source) ?? []) {
      const s = d.match(record, ctx);
      if (s > bestScore) {
        best = d;
        bestScore = s;
      }
    }
    if (!best) throw new Error(`No decoder (not even a fallback) for source ${source}`);

    if (opts.silent) return { out: best.decode(record, ctx) as Out, decoder: best.id };
    this.hits.set(best.id, (this.hits.get(best.id) ?? 0) + 1);
    if (bestScore <= 1) this.noteDrift(source, str(record.type) ?? '-', '(unknown record type)', version);
    const known = best.knownFields?.(record);
    if (known) {
      const recordType = str(record.type) ?? '-';
      for (const k of Object.keys(record)) if (!known.includes(k)) this.noteDrift(source, recordType, k, version);
    }
    return { out: best.decode(record, ctx) as Out, decoder: best.id };
  }

  private noteDrift(source: string, recordType: string, field: string, version: string | undefined): void {
    const key = `${source}\u0000${recordType}\u0000${field}`;
    let d = this.drift.get(key);
    if (!d) {
      d = { source, recordType, field, count: 0 };
      this.drift.set(key, d);
    }
    d.count++;
    if (version) {
      if (!d.firstVersion || compareVersions(version, d.firstVersion) < 0) d.firstVersion = version;
      if (!d.lastVersion || compareVersions(version, d.lastVersion) > 0) d.lastVersion = version;
    }
  }

  report(): { decoders: DecoderInfo[]; drift: DriftItem[] } {
    const decoders: DecoderInfo[] = [];
    for (const list of this.decoders.values()) {
      for (const d of list) {
        decoders.push({ id: d.id, source: d.source, description: d.description, versions: d.versions, hits: this.hits.get(d.id) ?? 0 });
      }
    }
    const drift = [...this.drift.values()].sort((a, b) => b.count - a.count).map((d) => ({ ...d }));
    return { decoders, drift };
  }
}
