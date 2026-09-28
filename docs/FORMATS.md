# Neue Formate hinzufügen

claude-inspect liest ausschließlich Dateien unter `~/.claude`. Wie eine Datei (oder eine
einzelne JSONL-Zeile) zu verstehen ist, entscheiden **Decoder**. Claude Code ändert seine
Dateiformate laufend, darum wird das Format **pro Record** erkannt, nicht pro Datei: Eine
fortgesetzte Session kann Zeilen aus mehreren Versionen enthalten.

## Ablauf

```
Rohdaten ─▶ FormatRegistry.decode(source, raw)
              │  fragt alle Decoder der Quelle: match(raw) → Score
              │  höchster Score gewinnt, Fallback (Score 1) fängt alles andere
              ▼
           Decoder.decode(raw) ─▶ normierte Typen aus src/shared/types.ts
              │
              └─ Felder außerhalb von knownFields() → Drift-Report (Seite „Formate“)
                 und `extra` am Eintrag (Button „+N“ in der Oberfläche)
```

Quellen (`SourceKind`): `transcript`, `process`, `job-state`, `job-timeline`,
`daemon-roster`, `subagent-meta`.

## Wann ein neuer Decoder?

- **Neue Felder** in einem bekannten Record (Drift-Report zeigt sie): Den bestehenden Decoder
  erweitern: Feld in die `*_FIELDS`-Liste aufnehmen und, falls sinnvoll, ins Domain-Model
  übernehmen.
- **Neuer Record-Typ** (Drift-Report: „(unbekannter Record-Typ)“): Oft reicht ein Eintrag in
  `META_TYPES` (`formats/transcript/other.ts`), sonst einen eigenen Decoder anlegen.
- **Inkompatible Strukturänderung** (gleicher `type`, anderes Layout): Einen neuen Decoder
  mit eigener Id (`…@3`) anlegen, der die neue Struktur per `match()` erkennt und einen
  höheren Score liefert. Den alten Decoder behalten: Ältere Dateien liegen weiter auf
  der Platte.

## Beispiel

```ts
// src/server/formats/transcript/message-v3.ts
import type { Decoder } from '../types.js';
import type { DecodedEntry } from './common.js';
import { inRange } from '../../util/semver.js';

export const messageDecoderV3: Decoder<DecodedEntry[]> = {
  id: 'transcript.message@3',
  source: 'transcript',
  description: 'Nachrichten mit neuem Block-Layout ab 2.3',
  versions: '>=2.3.0',
  match: (raw) =>
    raw.type === 'assistant' && Array.isArray(raw.blocks) && inRange(String(raw.version), '>=2.3.0') ? 20 : 0,
  decode: (raw) => [/* … */],
  knownFields: () => ['type', 'uuid', 'blocks' /* … */],
};
```

Danach in `src/server/formats/index.ts` registrieren. Scores: 1 = Fallback,
10 = Struktur passt, +5 = Versionsbereich passt. Ein spezifischerer Decoder sollte
immer höher bewerten als der allgemeinere.

## Tests & Fixtures

`tests/fixtures/transcript-<version>.jsonl` enthält je Claude-Code-Version ein Beispiel
pro Record-Form (type/subtype/Attachment-/Block-Typ). Die Dateien erzeugt
`npm run fixtures` aus den lokalen Transcripts. Dabei werden alle frei formulierten
Inhalte ersetzt, erhalten bleiben nur Struktur, Feldnamen, Typ-Diskriminatoren sowie
Tool- und Modellnamen.

`tests/decoders.test.ts` hält in `tests/snapshots/decoders.json` fest, welcher Decoder
jeden Fixture-Record liest und welche Einträge entstehen. Ablauf bei einer neuen
Claude-Code-Version:

1. `npm run fixtures`: neue Version bekommt eine eigene Fixture-Datei
2. `npm test`: Der Test „kein bekannter Record-Typ landet beim Fallback“ zeigt neue
   Record-Typen, die Seite „Formate“ zeigt neue Felder
3. Decoder erweitern oder ergänzen
4. `npm run test:update`: Snapshot bewusst aktualisieren und den Diff prüfen
