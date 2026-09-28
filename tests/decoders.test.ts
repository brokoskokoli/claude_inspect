/**
 * Snapshot-Test über anonymisierte Beispiel-Records je Claude-Code-Version
 * (tests/fixtures, erzeugt mit `npm run fixtures`). Prüft, welcher Decoder
 * jeden Record liest und welche Einträge entstehen. Ändert sich das absichtlich:
 * `npm run test:update`.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { registry } from '../src/server/formats/index.js';
import type { DecodedEntry } from '../src/server/formats/transcript/common.js';

const FIX = 'tests/fixtures';
const SNAP = 'tests/snapshots/decoders.json';

type Snap = Record<string, { recordType: string; decoder: string; kinds: string[] }[]>;

function current(): Snap {
  const out: Snap = {};
  for (const f of readdirSync(FIX).filter((n) => n.endsWith('.jsonl')).sort()) {
    out[f] = readFileSync(join(FIX, f), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l, i) => {
        const raw = JSON.parse(l);
        const { out: entries, decoder } = registry.decode<DecodedEntry[]>('transcript', raw, f, i, { silent: true });
        return { recordType: String(raw.type), decoder, kinds: entries.map((e) => e.kind) };
      });
  }
  return out;
}

test('Decoder-Snapshots je Version', () => {
  const now = current();
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(SNAP)) {
    writeFileSync(SNAP, JSON.stringify(now, null, 1) + '\n');
    return;
  }
  assert.deepEqual(now, JSON.parse(readFileSync(SNAP, 'utf8')));
});

test('kein bekannter Record-Typ landet beim Fallback', () => {
  const fallbacks = Object.entries(current()).flatMap(([f, rows]) =>
    rows.filter((r) => r.decoder === 'transcript.fallback').map((r) => `${f}: ${r.recordType}`),
  );
  assert.deepEqual(fallbacks, []);
});

test('jede Version liefert Nachrichten- und Tool-Einträge', () => {
  for (const [f, rows] of Object.entries(current())) {
    if (f.includes('none') || rows.length < 10) continue; // Dateien mit nur wenigen Records
    const kinds = new Set(rows.flatMap((r) => r.kinds));
    assert.ok(kinds.has('tool-use') && kinds.has('tool-result'), `${f}: ${[...kinds].join(',')}`);
  }
});
