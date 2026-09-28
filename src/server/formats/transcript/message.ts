import type { ResultPart, Usage } from '../../../shared/types.js';
import { clip, sanitize } from '../../util/sanitize.js';
import { inRange } from '../../util/semver.js';
import type { Decoder, DecodeContext, Raw } from '../types.js';
import { arr, bool, extraFields, isObj, obj, str } from '../util.js';
import { type DecodedEntry, ENVELOPE_FIELDS, envelope } from './common.js';

/**
 * user- und assistant-Records im Messages-API-Format:
 *   { type: "user"|"assistant", message: { role, content: string | Block[] , … }, … }
 * Belegt für 2.1.72 – 2.1.283. `message.content` ist bei Nutzer-Prompts teils
 * ein String, teils ein Block-Array; `toolUseResult` ist teils Objekt, teils String.
 */

const USER_FIELDS = [
  ...ENVELOPE_FIELDS,
  'message',
  'promptId',
  'sourceToolAssistantUUID',
  'sourceToolUseID',
  'toolUseResult',
  'permissionMode',
  'promptSource',
  'origin',
  'toolDenialKind',
  'isCompactSummary',
  'isVisibleInTranscriptOnly',
  'interruptedMessageId',
  'turnOrigin',
  'turnCompanion',
];

const ASSISTANT_FIELDS = [
  ...ENVELOPE_FIELDS,
  'message',
  'requestId',
  'effort',
  'perTurnEffort',
  'apiBlockIndex',
  'attributionAgent',
  'attributionSkill',
  'attributionMcpServer',
  'attributionMcpTool',
  'attributionPlugin',
  'advisorModel',
  'isApiErrorMessage',
  'error',
  'apiErrorStatus',
];

const ASSISTANT_MESSAGE_FIELDS = [
  'model',
  'id',
  'type',
  'role',
  'content',
  'stop_reason',
  'stop_sequence',
  'stop_details',
  'usage',
  'diagnostics',
  'context_management',
  'container',
  'input_transformations',
];

/** Vollständige Dateiinhalte in toolUseResult (Edit/Write) – für die Anzeige unnötig. */
const DROP_IN_RESULT = new Set(['originalFile']);

function resultParts(content: unknown): ResultPart[] {
  if (typeof content === 'string') return [{ type: 'text', ...clip(content) }];
  return arr(content).map((b): ResultPart => {
    if (!isObj(b)) return { type: 'other', value: b };
    switch (b.type) {
      case 'text':
        return { type: 'text', ...clip(str(b.text) ?? '') };
      case 'image':
        return { type: 'image', mediaType: str(obj(b.source)?.media_type) };
      case 'tool_reference':
        return { type: 'tool_reference', toolName: str(b.tool_name) ?? '?' };
      default:
        return { type: 'other', value: sanitize(b) };
    }
  });
}

function decodeUser(raw: Raw, ctx: DecodeContext): DecodedEntry[] {
  const env = envelope(raw);
  const msg = obj(raw.message) ?? {};
  const content = msg.content;
  const out: DecodedEntry[] = [];
  const userFields = {
    permissionMode: str(raw.permissionMode),
    promptSource: str(raw.promptSource),
    origin: raw.origin,
    isCompactSummary: bool(raw.isCompactSummary),
  };

  if (typeof content === 'string') {
    out.push({ ...env, kind: 'user-text', text: clip(content).text, ...userFields });
  } else {
    for (const b of arr(content)) {
      if (!isObj(b)) continue;
      switch (b.type) {
        case 'text':
          out.push({ ...env, kind: 'user-text', text: clip(str(b.text) ?? '').text, ...userFields });
          break;
        case 'tool_result': {
          const tur = raw.toolUseResult;
          out.push({
            ...env,
            kind: 'tool-result',
            toolUseId: str(b.tool_use_id) ?? '',
            parts: resultParts(b.content),
            isError: b.is_error === true,
            structured: tur === undefined ? undefined : sanitize(tur, { dropKeys: DROP_IN_RESULT }),
            denied: str(raw.toolDenialKind),
          });
          break;
        }
        case 'image':
          out.push({ ...env, kind: 'image', mediaType: str(obj(b.source)?.media_type) });
          break;
        default:
          out.push({ ...env, kind: 'unknown', raw: sanitize(b) });
          ctx.reportUnknown('user.message.content', { [String(b.type)]: true }, []);
      }
    }
  }
  if (out.length === 0) out.push({ ...env, kind: 'user-text', text: '', ...userFields });
  const extra = extraFields(raw, USER_FIELDS);
  if (extra) out[0].extra = sanitize(extra) as Raw;
  return out;
}

function decodeAssistant(raw: Raw, ctx: DecodeContext): DecodedEntry[] {
  const env = envelope(raw);
  const msg = obj(raw.message) ?? {};
  const msgExtra = ctx.reportUnknown('assistant.message', msg, ASSISTANT_MESSAGE_FIELDS);
  const fields = {
    model: str(msg.model),
    messageId: str(msg.id),
    requestId: str(raw.requestId),
    usage: obj(msg.usage) as Usage | undefined,
    stopReason: msg.stop_reason === null ? null : str(msg.stop_reason),
    effort: str(raw.perTurnEffort) ?? str(raw.effort),
    attribution: {
      skill: str(raw.attributionSkill),
      agent: str(raw.attributionAgent),
      mcpServer: str(raw.attributionMcpServer),
      mcpTool: str(raw.attributionMcpTool),
      plugin: str(raw.attributionPlugin),
    },
    isApiError: bool(raw.isApiErrorMessage),
  };
  const out: DecodedEntry[] = [];
  for (const b of arr(msg.content)) {
    if (!isObj(b)) continue;
    switch (b.type) {
      case 'text':
        out.push({ ...env, ...fields, kind: 'assistant-text', text: clip(str(b.text) ?? '').text });
        break;
      case 'thinking':
        out.push({ ...env, ...fields, kind: 'thinking', text: clip(str(b.thinking) ?? '').text });
        break;
      case 'redacted_thinking':
        out.push({ ...env, ...fields, kind: 'thinking', text: '', redacted: true });
        break;
      case 'tool_use':
      case 'server_tool_use':
        out.push({
          ...env,
          ...fields,
          kind: 'tool-use',
          toolUseId: str(b.id) ?? '',
          name: str(b.name) ?? '?',
          input: (sanitize(obj(b.input) ?? {}) as Raw) ?? {},
        });
        break;
      default:
        out.push({ ...env, kind: 'unknown', raw: sanitize(b) });
        ctx.reportUnknown('assistant.message.content', { [String(b.type)]: true }, []);
    }
  }
  if (out.length === 0) {
    // z. B. API-Fehlermeldung ohne Inhalt
    out.push({ ...env, ...fields, kind: 'assistant-text', text: str(raw.error) ?? '' });
  }
  const extra = { ...extraFields(raw, ASSISTANT_FIELDS), ...(msgExtra ? { message: msgExtra } : {}) };
  if (Object.keys(extra).length) out[0].extra = sanitize(extra) as Raw;
  return out;
}

export const messageDecoder: Decoder<DecodedEntry[]> = {
  id: 'transcript.message@2',
  source: 'transcript',
  description: 'user/assistant records with Messages API content (text, thinking, tool calls and results)',
  versions: '>=2.0.0',
  match(raw) {
    if ((raw.type !== 'user' && raw.type !== 'assistant') || !isObj(raw.message)) return 0;
    return 10 + (inRange(str(raw.version), '>=2.0.0') ? 5 : 0);
  },
  decode(raw, ctx) {
    return raw.type === 'assistant' ? decodeAssistant(raw, ctx) : decodeUser(raw, ctx);
  },
  knownFields(raw) {
    return raw.type === 'assistant' ? ASSISTANT_FIELDS : USER_FIELDS;
  },
};
