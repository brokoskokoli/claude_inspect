import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { search } from '../src/server/history/search.js';
import { SearchIndex } from '../src/server/history/search-index.js';
import { queryTrigrams, Trigrams } from '../src/server/history/trigrams.js';
import { sessionName } from '../src/shared/names.js';

const T = (s: number) => new Date(Date.UTC(2026, 9, 25, 10, 0, s)).toISOString();
const long = 'x'.repeat(30_000);
const records = [
  { type: 'user', uuid: 'u1', timestamp: T(0), version: '2.1.310', message: { role: 'user', content: 'Bitte "baue"\n  das   Ding' } },
  { type: 'assistant', uuid: 'a1', timestamp: T(1), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la\n/tmp' } }] } },
  // Ausgabe länger als die Anzeigegrenze (24.000 Zeichen): der Teil dahinter muss auffindbar sein
  { type: 'user', uuid: 'u2', timestamp: T(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `${long}\nGANZ\tam Ende` }] } },
  { type: 'custom-title', customTitle: 'Shop backend', sessionId: 's1' },
];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ci-search-'));
  const path = join(dir, 's1.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, path, index: new SearchIndex(join(dir, 'index')) };
}

const file = (path: string, names?: string[]) => ({ path, sessionId: 's1', project: 'demo', names });
/** ohne Treffer aus der echten history.jsonl des Rechners */
async function find(query: string, index: SearchIndex, files: ReturnType<typeof file>[]) {
  const res = await search(query, files, new Set(['s1']), index);
  return { ...res, hits: res.hits.filter((h) => h.kind !== 'history-prompt') };
}

test('search index finds text regardless of case, whitespace, escapes and display limits', async () => {
  const { path, index } = setup();
  await index.update([path], true);
  assert.equal(index.ready, true);

  const q = async (query: string) => (await find(query, index, [file(path)])).hits;

  const prompt = await q('bitte "BAUE" das ding');
  assert.equal(prompt.length, 1);
  assert.equal(prompt[0].kind, 'user-text');
  assert.equal(prompt[0].line, 0);

  const cmd = await q('ls -la /tmp');
  assert.deepEqual(cmd.map((h) => [h.kind, h.toolName, h.toolUseId]), [['tool-use', 'Bash', 'toolu_1']]);

  const end = await q('ganz am ende');
  assert.deepEqual(end.map((h) => [h.kind, h.line]), [['tool-result', 2]]);

  // Metadaten (Tool-Name, Ids, Zeitstempel) sind keine Treffer
  assert.equal((await q('toolu_1')).length, 0);
  assert.equal((await q('2026-10-25')).length, 0);
});

test('search index grows incrementally and survives a restart', async () => {
  const { dir, path, index } = setup();
  await index.update([path], true);
  const before = index.bytes;
  appendFileSync(path, JSON.stringify({ type: 'assistant', uuid: 'a2', timestamp: T(3), message: { id: 'm2', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Neue Antwort' }] } }) + '\n');
  await index.update([path], false);
  assert.ok(index.bytes > before);

  // neuer Prozess: liest den Stand aus dem Manifest, indexiert nichts doppelt
  const again = new SearchIndex(join(dir, 'index'));
  await again.update([path], true);
  assert.equal(again.bytes, index.bytes);
  const hits = (await find('neue antwort', again, [file(path)])).hits;
  assert.deepEqual(hits.map((h) => [h.kind, h.line]), [['assistant-text', 4]]);

  // Datei ersetzt (kleiner) → neu aufbauen
  writeFileSync(path, JSON.stringify(records[0]) + '\n');
  await again.update([path], true);
  assert.equal((await find('neue antwort', again, [file(path)])).hits.length, 0);
  assert.equal((await find('das ding', again, [file(path)])).hits.length, 1);

  // gelöschtes Transcript fliegt beim vollständigen Abgleich raus
  await again.update([], true);
  assert.equal(again.bytes, 0);
});

test('session and agent names are hits', async () => {
  const { path, index } = setup();
  await index.update([path], true);
  const res = await find('my-shop-48', index, [file(path, ['Shop backend', 'my-shop-48'])]);
  assert.deepEqual(res.hits.map((h) => [h.kind, h.snippet]), [['name', 'my-shop-48']]);
});

test('results are flagged while the index is still being built', async () => {
  const { path, index } = setup();
  const res = await find('das ding', index, [file(path)]);
  assert.ok(res.indexing);
});

test('session name: own names win, derived process names only as fallback', () => {
  assert.deepEqual(sessionName({ name: 'my-shop-48', nameSource: 'derived' }, 'Shop backend'), { name: 'Shop backend', subtitle: 'my-shop-48' });
  assert.deepEqual(sessionName({ name: 'my-shop-48', nameSource: 'derived' }, undefined), { name: 'my-shop-48', subtitle: undefined });
  assert.deepEqual(sessionName({ name: 'Mein Name', nameSource: 'user' }, 'KI-Titel'), { name: 'Mein Name', subtitle: 'KI-Titel' });
  assert.deepEqual(sessionName({ name: 'Gleich', nameSource: 'user' }, 'Gleich'), { name: 'Gleich', subtitle: undefined });
  assert.deepEqual(sessionName(undefined, 'Titel'), { name: 'Titel', subtitle: undefined });
});

test('trigram filter: never drops a real hit, also after growing and without stored bit fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-tri-'));
  // viele verschiedene Dreierfolgen, damit das Bitfeld mehrmals wächst; dazu Umlaute und Großbuchstaben
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed);
  const word = () => Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyzÄÖÜäöüß0123456789'[rnd() % 43]).join('');
  const words = Array.from({ length: 20_000 }, word);
  const path = join(dir, 's1.jsonl');
  const lines = [];
  for (let i = 0; i < words.length; i += 200) lines.push(JSON.stringify({ type: 'user', uuid: `u${i}`, timestamp: T(0), message: { role: 'user', content: words.slice(i, i + 200).join(' ') } }));
  writeFileSync(path, lines.join('\n') + '\n');
  const other = join(dir, 's2.jsonl');
  writeFileSync(other, JSON.stringify(records[0]) + '\n');

  const index = new SearchIndex(join(dir, 'index'));
  await index.update([path, other], true);
  for (const w of words.filter((_, i) => i % 997 === 0)) {
    const hits = (await find(w.replace(/[a-z]/g, (c) => c.toUpperCase()), index, [file(path), { ...file(other), sessionId: 's2' }])).hits;
    assert.ok(hits.some((h) => h.sessionId === 's1'), `finds ${w}`);
  }
  // Index ohne gespeicherte Bitfelder (ältere Version): werden aus den Indexdateien neu berechnet
  for (const n of readdirSync(join(dir, 'index'))) if (n.endsWith('.tri')) rmSync(join(dir, 'index', n));
  const again = new SearchIndex(join(dir, 'index'));
  await again.update([path, other], true);
  assert.ok((await find(words[4321], again, [file(path)])).hits.length > 0);
  assert.equal(readdirSync(join(dir, 'index')).filter((n) => n.endsWith('.tri')).length, 2);
});

test('trigram filter skips files that cannot contain the term', () => {
  const t = new Trigrams();
  t.add('hello world');
  assert.equal(t.mayContain(queryTrigrams('hello')), true);
  assert.equal(t.mayContain(queryTrigrams('WORLD')), true);
  assert.equal(t.mayContain(queryTrigrams('zebra')), false);
  assert.deepEqual(queryTrigrams('ab'), [], 'two characters: no filter');
});
