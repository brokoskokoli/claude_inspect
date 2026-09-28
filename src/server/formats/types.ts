/**
 * Format-Erkennung: Jede Datenquelle (SourceKind) hat eine Reihe von Decodern.
 * Für jeden Record fragt die Registry alle Decoder der Quelle per match() nach
 * einem Score und nimmt den höchsten. Jede Quelle hat einen Fallback-Decoder,
 * damit nie ein Record verloren geht.
 *
 * Neues Format hinzufügen: neue Datei mit einem Decoder anlegen und in
 * formats/index.ts registrieren. Details: docs/FORMATS.md
 */

export type SourceKind =
  | 'transcript' // projects/<dir>/<session>.jsonl und subagents/agent-*.jsonl (eine Zeile = ein Record)
  | 'process' // sessions/<pid>.json
  | 'job-state' // jobs/<short>/state.json
  | 'job-timeline' // jobs/<short>/timeline.jsonl (eine Zeile = ein Record)
  | 'daemon-roster' // daemon/roster.json
  | 'subagent-meta' // projects/<dir>/<session>/subagents/agent-*.meta.json
  | 'task' // tasks/<session>/<n>.json
  | 'history'; // history.jsonl (eine Zeile = eine Eingabe)

export type Raw = Record<string, unknown>;

export interface DecodeContext {
  source: SourceKind;
  file: string;
  /** Zeilennummer bei JSONL-Quellen, sonst 0. */
  line: number;
  /** Meldet unbekannte Felder in verschachtelten Objekten an den Drift-Report. */
  reportUnknown(recordType: string, obj: Raw | undefined, known: readonly string[]): Raw | undefined;
}

export interface Decoder<Out> {
  /** Eindeutige Id, z. B. "transcript.message@2". */
  id: string;
  source: SourceKind;
  description: string;
  /** Informativ: Versionsbereich, für den das Format belegt ist. */
  versions?: string;
  /**
   * Bewertung: 0 = passt nicht. Konvention:
   *   1     Fallback
   *   10    Struktur passt (Pflichtfelder vorhanden)
   *   +5    zusätzlich passender Versionsbereich
   */
  match(raw: Raw, ctx: DecodeContext): number;
  decode(raw: Raw, ctx: DecodeContext): Out;
  /**
   * Top-Level-Felder, die dieser Decoder versteht. Alles andere wird im
   * Drift-Report gezählt. Kann pro Record-Typ verschieden sein.
   */
  knownFields?(raw: Raw): readonly string[] | undefined;
}
