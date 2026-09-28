import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameProcess } from '../src/server/sources/processes.js';
import { pathTail, projectName } from '../src/server/sources/projects.js';

test('pathTail handles POSIX and Windows paths', () => {
  assert.equal(pathTail('/Users/me/repo/'), 'repo');
  assert.equal(pathTail('C:\\Users\\me\\repo'), 'repo');
  assert.equal(pathTail('C:\\Users\\me\\repo\\'), 'repo');
});

test('projectName falls back to the encoded project dir on every OS', () => {
  assert.equal(projectName(undefined, '-Users-me-ai-repo'), 'ai-repo');
  assert.equal(projectName(undefined, '-home-me-ai-repo'), 'ai-repo');
  assert.equal(projectName(undefined, 'C--Users-me-ai-repo'), 'ai-repo');
});

test('sameProcess matches ps lstart text and timestamps in other formats', () => {
  assert.equal(sameProcess(undefined, 'Mon Sep 28 19:15:43 2026'), false, 'pid not running');
  assert.equal(sameProcess('Mon Sep 28 19:15:43 2026', 'Mon  Sep 28 19:15:43 2026'), true);
  assert.equal(sameProcess('Mon Sep 28 19:15:43 2026', 'Mon Sep 28 19:20:00 2026'), false, 'pid reused');
  assert.equal(sameProcess('2026-09-28T19:15:43.512Z', 'Mon Sep 28 19:15:43 2026'), true, 'ISO (Windows) vs lstart (UTC)');
  assert.equal(sameProcess('2026-09-28T19:15:43.512Z', String(Date.parse('2026-09-28T19:15:43Z'))), true, 'epoch ms');
  assert.equal(sameProcess('anything', undefined), true, 'no procStart recorded');
});
