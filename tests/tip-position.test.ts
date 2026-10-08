import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeTip } from '../src/shared/tip-position.js';

const inside = (b: { left: number; top: number }, s: { width: number; height: number }, vp: { width: number; height: number }) =>
  b.left >= 0 && b.top >= 0 && b.left + s.width <= vp.width && b.top + s.height <= vp.height;

test('room available: below-right of the pointer', () => {
  assert.deepEqual(placeTip({ x: 100, y: 100 }, { width: 200, height: 80 }, { width: 1280, height: 900 }), { left: 112, top: 112 });
});

test('right edge: flips to the left of the pointer', () => {
  const b = placeTip({ x: 1270, y: 100 }, { width: 200, height: 80 }, { width: 1280, height: 900 });
  assert.equal(b.left, 1270 - 12 - 200);
});

test('bottom edge: flips above the pointer', () => {
  const b = placeTip({ x: 100, y: 890 }, { width: 200, height: 80 }, { width: 1280, height: 900 });
  assert.equal(b.top, 890 - 12 - 80);
});

test('narrow phone: no side has room, so it is clamped into the viewport', () => {
  const vp = { width: 360, height: 800 };
  for (const x of [0, 5, 120, 180, 240, 355, 360])
    for (const y of [0, 400, 795]) {
      const s = { width: 300, height: 120 };
      assert.ok(inside(placeTip({ x, y }, s, vp), s, vp), `x=${x} y=${y}`);
    }
});

test('tooltip larger than the viewport keeps its start visible', () => {
  assert.deepEqual(placeTip({ x: 300, y: 300 }, { width: 500, height: 900 }, { width: 360, height: 800 }), { left: 8, top: 8 });
});
