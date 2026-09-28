import type { TaskItem } from '../../../shared/types.js';
import { sanitize } from '../../util/sanitize.js';
import type { Decoder, Raw } from '../types.js';
import { arr, extraFields, str } from '../util.js';

const FIELDS = ['id', 'subject', 'description', 'status', 'activeForm', 'owner', 'blocks', 'blockedBy'];
const ids = (v: unknown) => arr(v).map(String);

/** tasks/<sessionId>/<n>.json (TaskCreate/TaskUpdate). */
export const taskDecoder: Decoder<TaskItem> = {
  id: 'task@1',
  source: 'task',
  description: 'task of a session task list (status, dependencies)',
  match: (raw) => ('subject' in raw || 'status' in raw) && 'id' in raw ? 10 : 0,
  decode(raw) {
    const extra = extraFields(raw, FIELDS);
    return {
      id: String(raw.id),
      subject: str(raw.subject),
      description: str(raw.description),
      status: str(raw.status),
      activeForm: str(raw.activeForm),
      owner: str(raw.owner),
      blocks: ids(raw.blocks),
      blockedBy: ids(raw.blockedBy),
      extra: extra ? (sanitize(extra) as Raw) : undefined,
    };
  },
  knownFields: () => FIELDS,
};

export const taskFallback: Decoder<TaskItem> = {
  id: 'task.fallback',
  source: 'task',
  description: 'unknown task format',
  match: () => 1,
  decode: (raw) => ({ id: String(raw.id ?? '?'), blocks: [], blockedBy: [], extra: sanitize(raw) as Raw }),
};
