import type { SubagentInfo } from '../../../shared/types.js';
import { sanitize } from '../../util/sanitize.js';
import type { Decoder, Raw } from '../types.js';
import { extraFields, num, str } from '../util.js';

export type DecodedSubagentMeta = Pick<SubagentInfo, 'agentType' | 'description' | 'spawnDepth' | 'toolUseId' | 'background' | 'extra'>;

const FIELDS = ['agentType', 'description', 'toolUseId', 'spawnDepth', 'requestShape', 'requestNonInteractive'];

export const subagentMetaDecoder: Decoder<DecodedSubagentMeta> = {
  id: 'subagent-meta@1',
  source: 'subagent-meta',
  description: 'Subagent-Metadaten: Typ, Beschreibung, aufrufender Tool-Aufruf, Tiefe',
  match: (raw) => ('agentType' in raw || 'toolUseId' in raw ? 10 : 0),
  decode(raw) {
    const extra = extraFields(raw, FIELDS);
    return {
      agentType: str(raw.agentType),
      description: str(raw.description),
      toolUseId: str(raw.toolUseId),
      spawnDepth: num(raw.spawnDepth),
      background: raw.requestShape === 'background',
      extra: extra ? (sanitize(extra) as Raw) : undefined,
    };
  },
  knownFields: () => FIELDS,
};

export const subagentMetaFallback: Decoder<DecodedSubagentMeta> = {
  id: 'subagent-meta.fallback',
  source: 'subagent-meta',
  description: 'Unbekannte Subagent-Metadaten',
  match: () => 1,
  decode: (raw) => ({ extra: sanitize(raw) as Raw }),
};
