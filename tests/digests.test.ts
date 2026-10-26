import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DigestCache } from '../src/server/sources/digests.js';

test('digest cache: remembers the size it belongs to, survives a new instance, prune removes the rest', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'ci-digests-')), 'd');
  const c = new DigestCache<{ n: number }>(dir);
  assert.equal(await c.read('/p/a.jsonl'), undefined);
  await c.set('/p/a.jsonl', 10, { n: 1 });
  await c.set('/p/b.jsonl', 5, { n: 2 });
  const again = new DigestCache<{ n: number }>(dir);
  assert.deepEqual(await again.read('/p/a.jsonl'), { bytes: 10, data: { n: 1 } });
  await again.prune(['/p/a.jsonl']);
  assert.equal((await readdir(dir)).length, 1);
  assert.equal(await again.read('/p/b.jsonl'), undefined);
});
