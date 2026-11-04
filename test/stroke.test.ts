// Поглаживание мышкой: когда засчитываем, а когда курсор просто прошёл мимо.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STROKE, StrokeDetector, type StrokeEvent } from '../src/renderer/input/stroke';

/** Водим курсор туда-сюда по коту: шаг step px каждые dt мс, разворот каждые span px. */
function rub(d: StrokeDetector, t0: number, ms: number, { step = 12, dt = 16, span = 90, over = true } = {}): StrokeEvent[] {
  const out: StrokeEvent[] = [];
  let x = 100;
  let dir = 1;
  for (let t = t0; t <= t0 + ms; t += dt) {
    x += dir * step;
    if (x > 100 + span || x < 100) dir = -dir;
    const ev = d.feed(x, 50, t, over);
    if (ev) out.push(ev);
  }
  return out;
}

test('rubbing the cat back and forth for a second counts as petting', () => {
  const d = new StrokeDetector();
  const evs = rub(d, 0, 1500);
  assert.deepEqual(evs, ['pet']);
  assert.ok(d.active(1500));
});

test('a quick rub is not petting yet', () => {
  const d = new StrokeDetector();
  assert.deepEqual(rub(d, 0, STROKE.minMs - 200), []);
});

test('passing the cursor straight across the cat is not petting', () => {
  const d = new StrokeDetector();
  const evs: StrokeEvent[] = [];
  // медленно ведём курсор через кота в одну сторону: долго и далеко, но без разворотов
  for (let t = 0, x = 0; t < 3000; t += 16, x += 3) {
    const ev = d.feed(x, 50, t, true);
    if (ev) evs.push(ev);
  }
  assert.deepEqual(evs, []);
});

test('hovering over the cat without moving is not petting', () => {
  const d = new StrokeDetector();
  for (let t = 0; t < 3000; t += 16) assert.equal(d.feed(100, 50, t, true), null);
  assert.equal(d.active(3000), false);
});

test('keeping on petting brings more joy now and then, a pause starts over', () => {
  const d = new StrokeDetector();
  const end = STROKE.minMs + STROKE.repeatMs * 2 + 200;
  assert.deepEqual(rub(d, 0, end), ['pet', 'more', 'more']);
  // курсор замер, потом снова гладят: сначала набираем заново, радость не раньше паузы coolMs
  const t1 = end + STROKE.pauseMs + 100;
  assert.equal(d.active(t1), false);
  assert.deepEqual(rub(d, t1, 600), []);
});

test('slipping off the cat for a moment does not break petting, leaving does', () => {
  const d = new StrokeDetector();
  rub(d, 0, 600);
  rub(d, 616, 200, { over: false });
  assert.deepEqual(rub(d, 832, 800), ['pet']);
  const d2 = new StrokeDetector();
  rub(d2, 0, 600);
  rub(d2, 616, STROKE.leaveMs + 300, { over: false });
  assert.deepEqual(rub(d2, 616 + STROKE.leaveMs + 316, 600), []);
});

test('a bigger cat needs a longer stroke', () => {
  const d = new StrokeDetector();
  const evs: StrokeEvent[] = [];
  // медленно: 4 px за 16 мс, около 250 px в секунду
  for (let t = 0, x = 100, dir = 1; t <= 1500; t += 16) {
    x += dir * 4;
    if (x > 160 || x < 100) dir = -dir;
    const ev = d.feed(x, 50, t, true, 2);
    if (ev) evs.push(ev);
  }
  assert.deepEqual(evs, []);
});
