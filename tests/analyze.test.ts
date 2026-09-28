import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../src/server/model/analyze.js';
import type { Entry } from '../src/shared/types.js';

let seq = 0;
const base = (ts: string) => ({ seq: seq++, line: seq, decoder: 'test', recordType: 'test', timestamp: `2026-09-28T18:${ts}.000Z` });
const prompt = (ts: string, text: string): Entry => ({ ...base(ts), kind: 'user-text', text });
const answer = (ts: string, text: string): Entry => ({ ...base(ts), kind: 'assistant-text', text, stopReason: 'end_turn' });
const exit = (ts: string): Entry => prompt(ts, '<command-name>/exit</command-name>\n<command-message>exit</command-message>');
const archived = (ts: string): Entry => ({
  ...base(ts),
  kind: 'system',
  subtype: 'informational',
  text: 'Remote Control disconnected — this session was ended or archived from another device or app (code 4090)',
  data: {},
});

test('/exit after the last prompt marks the session as ended', () => {
  const a = analyze([prompt('00:00', 'do it'), answer('00:10', 'done'), exit('06:59')]);
  assert.deepEqual(a.ended, { reason: 'exit', at: '2026-09-28T18:06:59.000Z' });
});

test('archived from another device marks the session as ended', () => {
  const a = analyze([prompt('00:00', 'do it'), answer('00:10', 'done'), archived('16:52')]);
  assert.equal(a.ended?.reason, 'archived');
});

test('a new prompt or new work after /exit (resumed session) clears it', () => {
  assert.equal(analyze([prompt('00:00', 'a'), exit('01:00'), prompt('02:00', 'weiter')]).ended, undefined);
  assert.equal(analyze([prompt('00:00', 'a'), exit('01:00'), answer('02:00', 'resumed')]).ended, undefined);
  assert.equal(analyze([prompt('00:00', 'a'), answer('00:10', 'done')]).ended, undefined, 'just waiting');
});
