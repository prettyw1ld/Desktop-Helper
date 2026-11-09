// Кот охотится на курсор: крадётся и прыгает, бьёт лапой туда, где мышка.
import './setup';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { cat, CAT_H, CAT_W, cx, floorY } from '../src/renderer/cat/cat';
import { startCursorWatch, trackMouse, updateCursorWatch, watchPose } from '../src/renderer/cat/cursor-watch';
import { now } from '../src/renderer/core/util';
import { land, resetDesk } from './helpers';

beforeEach(() => {
  resetDesk('win32');
  mock.method(Math, 'random', () => 0);
  Object.assign(cat, { x: 600, y: floorY(), plat: null, huntCool: 0, swipeCool: 0, swipeUntil: 0, swipes: 0 });
  startCursorWatch(20_000);
});
afterEach(() => mock.restoreAll());

// курсор пошевелился в точке (x, y)
const wiggle = (x: number, y: number) => { trackMouse(x + 3, y); trackMouse(x, y); };

test('cursor running along the floor nearby: the cat crouches, wiggles and pounces on it', () => {
  const floor = floorY() + CAT_H - 20;
  wiggle(cx() - 250, floor);
  const t = now();
  updateCursorWatch(t);
  assert.ok(cat.huntUntil > t, 'starts stalking');
  assert.equal(watchPose(t), 'huntL', 'crouches facing the cursor');

  updateCursorWatch(cat.huntUntil + 1);
  assert.equal(cat.state, 'jump', 'pounces');
  assert.equal(cat.jump!.tx + CAT_W / 2, 600 + CAT_W / 2 - 250, 'jumps to the cursor');
  cat.x = cat.jump!.tx;
  land();
  assert.equal(cat.state, 'act');
  assert.equal(cat.act, 'heartsSitF', 'caught the mouse');
});

test('cursor above the head: the cat stands up and reaches for it', () => {
  wiggle(cx() + 10, cat.y + CAT_H - 175);
  assert.equal(watchPose(now()), 'hind');
});

test('cursor right in front: front paw swipes, alternating the two drawn variants', () => {
  const y = cat.y + CAT_H * 0.45;
  wiggle(cx() + 5, y);
  assert.equal(watchPose(now()), 'swipeSitF');
  cat.swipeUntil = 0;
  cat.swipeCool = 0;
  wiggle(cx() + 5, y);
  assert.equal(watchPose(now()), 'swipeSitF2');
});

test('cursor at the side: side swipe towards it', () => {
  wiggle(cx() - 60, cat.y + CAT_H * 0.45);
  assert.equal(watchPose(now()), 'swipeSitL');
});
