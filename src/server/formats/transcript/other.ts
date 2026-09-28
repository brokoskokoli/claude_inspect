import { sanitize } from '../../util/sanitize.js';
import type { Decoder, Raw } from '../types.js';
import { extraFields, isObj, obj, str, without } from '../util.js';
import { type DecodedEntry, ENVELOPE_FIELDS, envelope } from './common.js';

// ---------------------------------------------------------------------------
// system-Records: stop_hook_summary, turn_duration, api_error, compact_boundary, …

const SYSTEM_FIELDS = [
  ...ENVELOPE_FIELDS,
  'subtype',
  'level',
  'content',
  // subtype-spezifisch
  'hookCount',
  'hookInfos',
  'hookErrors',
  'hookAdditionalContext',
  'preventedContinuation',
  'stopReason',
  'hasOutput',
  'toolUseID',
  'durationMs',
  'messageCount',
  'error',
  'retryInMs',
  'retryAttempt',
  'maxRetries',
  'source',
  'pendingBackgroundAgentCount',
  'compactMetadata',
  'commandRun',
  'usageReport',
  'url',
  'contextUsage',
];

export const systemDecoder: Decoder<DecodedEntry[]> = {
  id: 'transcript.system@2',
  source: 'transcript',
  description: 'system-Records (Hooks, Turn-Dauer, API-Fehler, Kompaktierung, Remote-Control …)',
  versions: '>=2.0.0',
  match: (raw) => (raw.type === 'system' && typeof raw.subtype === 'string' ? 10 : 0),
  decode(raw) {
    const data = sanitize(without(raw, [...ENVELOPE_FIELDS, 'subtype', 'level', 'content'])) as Raw;
    return [
      {
        ...envelope(raw),
        kind: 'system',
        subtype: str(raw.subtype) ?? '?',
        level: str(raw.level),
        text: str(raw.content),
        data,
      },
    ];
  },
  knownFields: () => SYSTEM_FIELDS,
};

// ---------------------------------------------------------------------------
// attachment-Records: Kontext, den Claude Code dem Modell mitgibt

const ATTACHMENT_FIELDS = [...ENVELOPE_FIELDS, 'attachment', 'rendered', 'renderedInHumanTurn'];

export const attachmentDecoder: Decoder<DecodedEntry[]> = {
  id: 'transcript.attachment@2',
  source: 'transcript',
  description: 'attachment-Records (Dateien, Erinnerungen, Skill-/Tool-Listen, Hook-Kontext …)',
  versions: '>=2.1.0',
  match: (raw) => (raw.type === 'attachment' && isObj(raw.attachment) ? 10 : 0),
  decode(raw) {
    const att = obj(raw.attachment) ?? {};
    const entry: DecodedEntry = {
      ...envelope(raw),
      kind: 'attachment',
      attachmentType: str(att.type) ?? '?',
      data: sanitize(without(att, ['type'])) as Raw,
    };
    const extra = extraFields(raw, ATTACHMENT_FIELDS);
    if (raw.rendered !== undefined) entry.data.__rendered = sanitize(raw.rendered);
    if (extra) entry.extra = sanitize(extra) as Raw;
    return [entry];
  },
  knownFields: () => ATTACHMENT_FIELDS,
};

// ---------------------------------------------------------------------------
// Zustands-Records ohne Nachrichteninhalt: Titel, Modus, Kosten, Queue …

export const META_TYPES = [
  'custom-title',
  'ai-title',
  'agent-name',
  'agent-setting',
  'mode',
  'permission-mode',
  'last-prompt',
  'cost-state',
  'worktree-state',
  'relocated',
  'continued-in',
  'bridge-session',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'frame-link',
  'atis-latch',
  'artifact-comment-monitor',
  'artifact-autoreact-ledger',
];

export const metaDecoder: Decoder<DecodedEntry[]> = {
  id: 'transcript.meta@2',
  source: 'transcript',
  description: `Zustands-Records (${META_TYPES.length} Typen: Titel, Modus, Kosten, Queue, Worktree …)`,
  versions: '>=2.1.0',
  match: (raw) => (typeof raw.type === 'string' && META_TYPES.includes(raw.type) ? 10 : 0),
  decode(raw) {
    return [
      {
        ...envelope(raw),
        kind: 'meta',
        metaType: str(raw.type)!,
        data: sanitize(without(raw, ['type', 'sessionId', 'timestamp'])) as Raw,
      },
    ];
  },
};

// ---------------------------------------------------------------------------

export const transcriptFallback: Decoder<DecodedEntry[]> = {
  id: 'transcript.fallback',
  source: 'transcript',
  description: 'Unbekannte Records – werden roh angezeigt und im Drift-Report gemeldet',
  match: () => 1,
  decode(raw) {
    return [{ ...envelope(raw), kind: 'unknown', raw: sanitize(raw) }];
  },
};
