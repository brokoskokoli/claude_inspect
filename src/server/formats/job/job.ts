import type { FanItem, JobInfo, JobTimelineItem } from '../../../shared/types.js';
import { sanitize } from '../../util/sanitize.js';
import type { Decoder, Raw } from '../types.js';
import { arr, extraFields, isObj, num, obj, str } from '../util.js';

export type DecodedJobState = Omit<JobInfo, 'short' | 'timeline' | 'launch' | 'decoder'>;

const STATE_FIELDS = [
  'state',
  'detail',
  'tempo',
  'inFlight',
  'fan',
  'tokens',
  'output',
  'children',
  'linkScanOffset',
  'linkScanPath',
  'template',
  'respawnFlags',
  'intent',
  'name',
  'nameSource',
  'sessionId',
  'resumeSessionId',
  'daemonShort',
  'cliVersion',
  'cwd',
  'bridgeSessionId',
  'bridgeOutboundOnly',
  'bridgeOwnerAccountUuid',
  'bridgeOwnerOrganizationUuid',
  'bgIsolation',
  'providerEnv',
  'interactiveLineage',
  'backend',
  'createdAt',
  'updatedAt',
  'firstTerminalAt',
  'lastTerminalAt',
  'deadEpochReapedAt',
  'bridgeSessionSeq',
  'forkSourceAlive',
  'forkBoundaryAt',
  'forkSessionId',
  'forkParentSessionId',
];

export const jobStateDecoder: Decoder<DecodedJobState> = {
  id: 'job-state@1',
  source: 'job-state',
  description: 'background job: state, current step, running shells/monitors (fan)',
  versions: '>=2.1.200',
  match: (raw) => (typeof raw.state === 'string' && 'sessionId' in raw ? 10 : 0),
  decode(raw) {
    const fan: FanItem[] = arr(raw.fan)
      .filter(isObj)
      .map((f) => ({ id: str(f.id) ?? '', kind: str(f.kind) ?? '?', label: str(f.label) ?? '', startedAt: num(f.startedAt) }));
    const extra = extraFields(raw, STATE_FIELDS);
    return {
      state: str(raw.state),
      detail: str(raw.detail),
      tempo: str(raw.tempo),
      fan,
      tokens: num(raw.tokens),
      intent: str(raw.intent),
      name: str(raw.name),
      sessionId: str(raw.sessionId),
      resumeSessionId: str(raw.resumeSessionId),
      cwd: str(raw.cwd),
      cliVersion: str(raw.cliVersion),
      createdAt: str(raw.createdAt),
      updatedAt: str(raw.updatedAt),
      inFlight: obj(raw.inFlight),
      fork:
        raw.forkParentSessionId || raw.forkSessionId
          ? {
              parentSessionId: str(raw.forkParentSessionId),
              sessionId: str(raw.forkSessionId),
              boundaryAt: str(raw.forkBoundaryAt),
              sourceAlive: typeof raw.forkSourceAlive === 'boolean' ? raw.forkSourceAlive : undefined,
            }
          : undefined,
      extra: extra ? (sanitize(extra) as Raw) : undefined,
    };
  },
  knownFields: () => STATE_FIELDS,
};

export const jobStateFallback: Decoder<DecodedJobState> = {
  id: 'job-state.fallback',
  source: 'job-state',
  description: 'unknown job state',
  match: () => 1,
  decode: (raw) => ({ fan: [], extra: sanitize(raw) as Raw }),
};

export const jobTimelineDecoder: Decoder<JobTimelineItem> = {
  id: 'job-timeline@1',
  source: 'job-timeline',
  description: 'job status changes',
  match: (raw) => (typeof raw.at === 'string' ? 10 : 0),
  decode: (raw) => ({ at: str(raw.at)!, state: str(raw.state), detail: str(raw.detail), text: str(raw.text) }),
  knownFields: () => ['at', 'state', 'detail', 'text'],
};

export const jobTimelineFallback: Decoder<JobTimelineItem> = {
  id: 'job-timeline.fallback',
  source: 'job-timeline',
  description: 'unknown timeline entry',
  match: () => 1,
  decode: (raw) => ({ at: str(raw.at) ?? '', text: JSON.stringify(sanitize(raw)) }),
};

// ---------------------------------------------------------------------------
// daemon/roster.json → welcher Job aus welcher Session gestartet wurde

export type RosterLaunch = Record<string, NonNullable<JobInfo['launch']>>;

export const rosterDecoder: Decoder<RosterLaunch> = {
  id: 'daemon-roster@1',
  source: 'daemon-roster',
  description: 'daemon workers with launch info (resume/fork, source session)',
  match: (raw) => (isObj(raw.workers) ? 10 : 0),
  decode(raw) {
    const out: RosterLaunch = {};
    for (const [short, w] of Object.entries(obj(raw.workers) ?? {})) {
      const dispatch = obj(obj(w)?.dispatch);
      const launch = obj(dispatch?.launch);
      const from = str(launch?.sessionId);
      out[short] = {
        mode: str(launch?.mode),
        fork: launch?.fork === true,
        source: str(dispatch?.source),
        // sessionId ist hier teils ein Pfad zur .jsonl-Datei
        fromSessionId: from?.replace(/^.*\//, '').replace(/\.jsonl$/, ''),
      };
    }
    return out;
  },
};

export const rosterFallback: Decoder<RosterLaunch> = {
  id: 'daemon-roster.fallback',
  source: 'daemon-roster',
  description: 'unknown roster format',
  match: () => 1,
  decode: () => ({}),
};
