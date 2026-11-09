// Кот караулит курсор: у пола ложится мордой к нему и бьёт лапой; сидя бьёт лапой туда, где мышка.
import './setup';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { cat, CAT_H, cx, floorY } from '../src/renderer/cat/cat';
import { startCursorWatch, trackMouse, updateCursorWatch, watchPose } from '../src/renderer/cat/cursor-watch';
import { now } from '../src/renderer/core/util';
import { resetDesk } from './helpers';

beforeEach(() => {
  resetDesk('win32');
  mock.method(Math, 'random', () => 0);
  Object.assign(cat, { x: 600, y: floorY(), plat: null, huntCool: 0, swipeCool: 0, swipeUntil: 0, swipes: 0 });
  startCursorWatch(20_000);
});
afterEach(() => mock.restoreAll());

// курсор пошевелился в точке (x, y)
const wiggle = (x: number, y: number) => { trackMouse(x + 3, y); trackMouse(x, y); };

test('cursor running along the floor nearby: the cat lies down facing it and swipes when it comes close', () => {
  const floor = floorY() + CAT_H - 20;
  wiggle(cx() - 250, floor);
  const t = now();
  updateCursorWatch(t);
  assert.ok(cat.huntUntil > t, 'lies down');
  assert.equal(watchPose(t), 'lieWatchL', 'facing the cursor, tail moving');

  // мышка подбежала к лапам: удар лапой
  wiggle(cx() - 100, floor);
  updateCursorWatch(t + 800);
  assert.equal(watchPose(t + 800), 'lieSwipeL');

  // перебежала на другую сторону: кот поворачивается к ней
  wiggle(cx() + 200, floor);
  updateCursorWatch(t + 1500);
  assert.equal(watchPose(t + 1500), 'lieWatchR');

  // ушла наверх: кот садится и снова следит головой
  wiggle(cx() + 200, cat.y - 100);
  updateCursorWatch(t + 1600);
  assert.equal(cat.huntUntil, 0);
  assert.equal(typeof watchPose(t + 1600), 'object');
  assert.equal(cat.state, 'idle');
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
