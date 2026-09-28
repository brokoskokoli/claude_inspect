import type { Entry } from '../../../shared/types.js';
import type { Raw } from '../types.js';
import { bool, str } from '../util.js';

/** Ein dekodierter Eintrag, bevor der Store seq/line/decoder vergibt. */
export type DecodedEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'seq' | 'line' | 'decoder'> : never) : never;

/** Felder, die (fast) jeder Nachrichten-Record trägt. */
export const ENVELOPE_FIELDS = [
  'type',
  'uuid',
  'parentUuid',
  'logicalParentUuid',
  'timestamp',
  'isSidechain',
  'isMeta',
  'userType',
  'cwd',
  'sessionId',
  'session_id',
  'sessionKind',
  'version',
  'gitBranch',
  'entrypoint',
  'slug',
  'agentId',
] as const;

export function envelope(raw: Raw) {
  return {
    recordType: str(raw.type) ?? '-',
    version: str(raw.version),
    uuid: str(raw.uuid),
    parentUuid: raw.parentUuid === null ? null : str(raw.parentUuid),
    timestamp: str(raw.timestamp),
    agentId: str(raw.agentId),
    isSidechain: bool(raw.isSidechain),
    isMeta: bool(raw.isMeta),
  };
}
