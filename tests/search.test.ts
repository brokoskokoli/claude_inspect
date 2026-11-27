import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { search } from '../src/server/history/search.js';
import { SearchIndex } from '../src/server/history/search-index.js';
import { queryTrigrams, Trigrams } from '../src/server/history/trigrams.js';
import { sessionName } from '../src/shared/names.js';
import { parseQuery } from '../src/shared/search-query.js';

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

test('query syntax: words, "phrases" and ~N', () => {
  const pick = (q: string) => (({ terms, window, min }) => ({ terms, window, min }))(parseQuery(q));
  assert.deepEqual(pick('Docker  compose'), { terms: ['docker', 'compose'], window: 1, min: 2 });
  assert.deepEqual(pick('"Docker   compose" up ~3'), { terms: ['docker compose', 'up'], window: 3, min: 2 });
  assert.deepEqual(pick('"offen bis zum Ende'), { terms: ['offen bis zum ende'], window: 1, min: 1 });
  assert.deepEqual(pick('~/ai/x ~0'), { terms: ['~/ai/x'], window: 1, min: 1 });
  assert.equal(pick('a b c').min, 2, 'from three terms on: partial hits');
  assert.equal(pick('a b c d').min, 3);
  assert.equal(parseQuery('Docker Compose up').literal, 'docker compose up');
});

const msg = (i: number, role: 'user' | 'assistant', text: string) =>
  role === 'user'
    ? { type: 'user', uuid: `u${i}`, timestamp: T(i), message: { role, content: text } }
    : { type: 'assistant', uuid: `a${i}`, timestamp: T(i), message: { id: `m${i}`, model: 'claude-opus-5-5', content: [{ type: 'text', text }] } };

async function indexed(texts: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-query-'));
  const path = join(dir, 's1.jsonl');
  writeFileSync(path, texts.map((t, i) => JSON.stringify(msg(i, i % 2 ? 'assistant' : 'user', t))).join('\n') + '\n');
  const index = new SearchIndex(join(dir, 'index'));
  await index.update([path], true);
  return async (query: string, names?: string[]) => (await find(query, index, [file(path, names)])).hits;
}

test('several words must appear in the same entry, phrases exactly, ~N in neighbouring entries', async () => {
  const search = await indexed(['Starte compose mit Docker', 'Erst docker compose up, dann warten', 'Apfel', 'nichts', 'Birne', 'Kirsche']);
  const q = async (query: string) => (await search(query)).map((h) => [h.line, h.span]);

  assert.deepEqual(await q('DOCKER compose'), [[1, undefined], [0, undefined]], 'any order, same entry; literal first');
  assert.deepEqual(await q('"docker compose"'), [[1, undefined]], 'phrase only where it stands exactly');
  assert.deepEqual(await q('"compose docker"'), []);
  assert.deepEqual(await q('apfel birne'), [], 'different entries');
  assert.deepEqual(await q('apfel birne ~2'), [], 'two entries apart');
  assert.deepEqual(await q('apfel birne ~3'), [[2, 3]]);
  assert.deepEqual(await q('birne apfel ~3'), [[2, 3]], 'order does not matter');
  assert.deepEqual(await q('kirsche birne ~2'), [[4, 2]]);
  assert.deepEqual(await q('apfel zebra ~6'), [], 'two terms: both needed');
});

test('ranking: all terms before partial, literal, tight, frequent; names before text', async () => {
  const search = await indexed([
    'rot und blau, aber kein gelb', // 0: 3 von 4
    'rot ' + 'x '.repeat(200) + 'blau gelb grün', // 1: alle vier, weit auseinander
    'rot blau gelb grün', // 2: alle vier, wortwörtlich
    'grün gelb blau rot', // 3: alle vier, nah, andere Reihenfolge
    'nur rot', // 4: 1 von 4 – kein Treffer
    'grün gelb blau rot grün gelb blau rot', // 5: alle vier, nah, doppelt so oft
  ]);
  const hits = await search('rot blau gelb grün');
  assert.deepEqual(hits.map((h) => [h.line, h.matched]), [[2, 4], [5, 4], [3, 4], [1, 4], [0, 3]]);
  // Ausschnitt zeigt alle Begriffe, auch wenn sie weit auseinander stehen
  for (const t of ['rot', 'blau', 'gelb', 'grün']) assert.ok(hits.find((h) => h.line === 1)!.snippet.includes(t), t);

  const named = await search('rot blau gelb grün', ['Rot Blau Gelb Grün']);
  assert.equal(named[0].kind, 'name', 'title beats text');

  const span = await indexed(['alpha', 'beta', 'x', 'alpha', 'x', 'x', 'beta']);
  assert.deepEqual((await span('alpha beta ~4')).map((h) => [h.line, h.span]), [[0, 2], [3, 4]], 'closer entries first');
});
