// Кот за шкирку качается от движения мыши, а не сам по себе.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newSwing, SWING, swingPickUp, swingStep } from '../src/renderer/cat/swing';

const DT = 1 / 30;
const run = (s: ReturnType<typeof newSwing>, xs: (number | null)[]): number[] => xs.map((x) => swingStep(s, x, DT));

test('кота держат неподвижно — висит ровно', () => {
  const s = newSwing();
  const a = run(s, Array(60).fill(500));
  assert.ok(a.every((v) => Math.abs(v) < 0.01));
});

test('рывок вправо — тело отстаёт влево (угол положительный), потом раскачивается и успокаивается', () => {
  const s = newSwing();
  run(s, [500, 500]);
  const moving = run(s, [530, 560, 590, 620, 650]);
  assert.ok(Math.max(...moving) > 5, `угол ${Math.max(...moving)}`);
  const after = run(s, Array(120).fill(650));
  assert.ok(Math.min(...after) < -1, 'после остановки качается в другую сторону');
  assert.ok(Math.abs(after.at(-1)!) < 0.5, 'через 4 секунды висит ровно');
});

test('рывок влево — угол отрицательный; угол не больше предела', () => {
  const s = newSwing();
  run(s, [900]);
  const a = run(s, [700, 500, 300, 100, 0]);
  assert.ok(Math.min(...a) < -5);
  assert.ok(a.every((v) => Math.abs(v) <= SWING.maxAngle));
});

test('ровное движение — небольшой наклон против движения', () => {
  const s = newSwing();
  const xs = Array.from({ length: 150 }, (_, i) => 100 + i * 20); // 600 px/с
  const a = run(s, xs);
  assert.ok(a.at(-1)! > 2 && a.at(-1)! <= SWING.maxLean + 0.5, `угол ${a.at(-1)}`);
});

test('отпустили — качание быстро гаснет; подняли — лёгкий рывок', () => {
  const s = newSwing();
  run(s, [0, 300, 600]);
  const a = run(s, Array(15).fill(null));
  assert.equal(a.at(-1), 0);
  swingPickUp(s, 1);
  const b = run(s, [400, 400, 400]);
  assert.ok(b.some((v) => Math.abs(v) > 0.5));
});
