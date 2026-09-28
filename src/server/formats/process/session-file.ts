import type { ProcessInfo } from '../../../shared/types.js';
import { sanitize } from '../../util/sanitize.js';
import type { Decoder, Raw } from '../types.js';
import { arr, extraFields, num, str } from '../util.js';

export type DecodedProcess = Omit<ProcessInfo, 'alive' | 'file' | 'decoder'> & { procStart?: string };

const FIELDS = [
  'pid',
  'sessionId',
  'cwd',
  'startedAt',
  'procStart',
  'version',
  'kind',
  'entrypoint',
  'name',
  'nameSource',
  'nameSince',
  'status',
  'statusUpdatedAt',
  'updatedAt',
  'bridgeSessionId',
  'jobId',
  'parkedJobId',
  'peerProtocol',
  'peerFeatures',
  'pidDomain',
  'messagingSocketPath',
  'agent',
];

function decode(raw: Raw): DecodedProcess {
  const extra = extraFields(raw, FIELDS);
  return {
    pid: num(raw.pid) ?? -1,
    sessionId: str(raw.sessionId) ?? '',
    cwd: str(raw.cwd),
    name: str(raw.name),
    nameSource: str(raw.nameSource),
    kind: str(raw.kind),
    entrypoint: str(raw.entrypoint),
    version: str(raw.version),
    status: str(raw.status),
    statusUpdatedAt: num(raw.statusUpdatedAt),
    startedAt: num(raw.startedAt),
    updatedAt: num(raw.updatedAt),
    bridgeSessionId: raw.bridgeSessionId === null ? null : str(raw.bridgeSessionId),
    jobId: str(raw.jobId),
    parkedJobId: str(raw.parkedJobId),
    peerFeatures: arr(raw.peerFeatures).filter((x): x is string => typeof x === 'string'),
    agent: str(raw.agent),
    procStart: str(raw.procStart),
    extra: extra ? (sanitize(extra) as Raw) : undefined,
  };
}

/** sessions/<pid>.json ab ca. 2.1.2xx: mit Status, Namen und Peer-Messaging. */
export const processDecoderV2: Decoder<DecodedProcess> = {
  id: 'process.session-file@2',
  source: 'process',
  description: 'running process with status (busy/idle), name, job and bridge link',
  versions: '>=2.1.200',
  match: (raw) => (typeof raw.pid === 'number' && typeof raw.sessionId === 'string' && 'status' in raw ? 15 : 0),
  decode,
  knownFields: () => FIELDS,
};

/** Ältere, schlanke Variante (z. B. 2.1.114): nur pid, sessionId, cwd, startedAt, version, kind. */
export const processDecoderV1: Decoder<DecodedProcess> = {
  id: 'process.session-file@1',
  source: 'process',
  description: 'running process, older variant without status',
  versions: '<2.1.200',
  match: (raw) => (typeof raw.pid === 'number' && typeof raw.sessionId === 'string' ? 10 : 0),
  decode,
  knownFields: () => FIELDS,
};

export const processFallback: Decoder<DecodedProcess> = {
  id: 'process.fallback',
  source: 'process',
  description: 'unknown process file',
  match: () => 1,
  decode: (raw) => ({ pid: num(raw.pid) ?? -1, sessionId: str(raw.sessionId) ?? '', extra: sanitize(raw) as Raw }),
};
