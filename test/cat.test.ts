// Кот: перенос за шкирку во время урока, облачко в пределах экрана, слежка за курсором.
import './setup';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { cat, CAT_H, SCRUFF_Y, floorY } from '../src/renderer/cat/cat';
import { startCursorWatch, trackMouse, updateCursorWatch, watchPose } from '../src/renderer/cat/cursor-watch';
import { dom } from '../src/renderer/core/dom';
import { now } from '../src/renderer/core/util';
import { coach, runScenario } from '../src/renderer/guide/coach';
import { endGuide } from '../src/renderer/guide/control';
import * as Scenarios from '../src/renderer/guide/scenarios';
import { guide } from '../src/renderer/guide/state';
import { initMouse } from '../src/renderer/input/mouse';
import { placeBubble } from '../src/renderer/ui/bubble';
import { bubbleText, desk, resetDesk, settle } from './helpers';

initMouse();

beforeEach(() => {
  resetDesk('darwin');
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});
afterEach(() => {
  endGuide(false);
  mock.timers.reset();
});

const mouse = (target: EventTarget, type: string, x = 0, y = 0) =>
  target.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true }));

test('dragging the cat by the scruff keeps the lesson and restores its current instruction', async () => {
  runScenario(Scenarios.byId('files-learn'));
  await settle();
  mouse(dom.cat, 'mousedown', 230, 430);
  mouse(document, 'mousemove', 330, 230);
  assert.equal(cat.state, 'drag');
  assert.ok(dom.cat.classList.contains('dragging'));
  // пока кота несут, урок не перескакивает на следующий шаг
  desk.top = { proc: 'Finder', title: 'Мои открытки' };
  mock.timers.tick(1200);
  await settle();
  assert.equal(coach.advancing, false);

  mouse(document, 'mouseup', 330, 230);
  assert.equal(guide.active, true);
  assert.equal(coach.active, true);
  assert.equal(coach.i, 0);
  assert.equal(coach.keepPosition, true);
  assert.equal(cat.state, 'perch');
  // курсор держит кота за загривок: верх блока кота смещён от курсора на высоту загривка
  const expected = 230 - (CAT_H - (CAT_H - SCRUFF_Y));
  assert.equal(cat.y, Math.max(0, Math.min(expected, floorY())));
  assert.ok(bubbleText().includes('Мои открытки'));
});

test('instruction stays inside the viewport as the cat moves from top to bottom', () => {
  Object.defineProperty(dom.bubble, 'offsetWidth', { value: 340, configurable: true });
  Object.defineProperty(dom.bubble, 'offsetHeight', { value: 450, configurable: true });
  dom.bubble.classList.remove('hidden');
  for (const [x, y] of [[20, 0], [1100, 0], [1100, 660], [20, 660], [600, -200]] as const) {
    cat.x = x;
    cat.y = y;
    placeBubble();
    const [dx = 0, dy = 0] = String(dom.bubble.style.translate).split(' ').map(parseFloat);
    const below = dom.bubble.classList.contains('below');
    const top = (below ? y + 154 : y + 12 - 450) + dy;
    const left = x + 75 - 170 + dx;
    assert.ok(top >= 8 && top + 450 <= 792, `vertical position at cat ${x},${y}`);
    assert.ok(left >= 8 && left + 340 <= 1272, `horizontal position at cat ${x},${y}`);
    if (y === 660) assert.equal(below, false);
  }
});

test('the cat turns its head after the cursor one drawn position at a time and swipes at it up close', () => {
  cat.x = 500;
  cat.y = 600;                                // центр кота x = 575, голова на y ≈ 620
  startCursorWatch(8000);
  assert.equal(cat.state, 'idle');
  const head = () => { const p = watchPose(now()); assert.ok(typeof p !== 'string'); return p; };
  assert.deepEqual([head().gaze, head().up], [0, false]);
  const t0 = now();
  trackMouse(0, 640);                         // далеко слева, на уровне головы
  updateCursorWatch(t0 + 100);
  assert.equal(head().gaze, -1);              // не прыжком, а по одному положению
  for (let i = 2; i <= 5; i++) updateCursorWatch(t0 + i * 100);
  assert.equal(head().gaze, -3);
  trackMouse(1250, 640);                      // ушёл вправо: голова идёт через середину
  updateCursorWatch(t0 + 600);
  assert.equal(head().gaze, -2);
  for (let i = 7; i <= 12; i++) updateCursorWatch(t0 + i * 100);
  assert.equal(head().gaze, 3);
  trackMouse(-400, 640);                      // на мониторе слева от основного координаты меньше нуля
  for (let i = 13; i <= 18; i++) updateCursorWatch(t0 + i * 100);
  assert.equal(head().gaze, -3);
  trackMouse(1250, 100);                      // курсор высоко: смотрит вверх
  updateCursorWatch(t0 + 1900);
  assert.equal(head().up, true);
  trackMouse(575, 663);                       // шевелится у самой морды
  assert.match(String(watchPose(now())), /^swipeSit[LR]$/);
});

test('the head does not twitch while the cursor hovers near the border of two positions', () => {
  cat.x = 500;
  cat.y = 600;
  startCursorWatch(8000);
  const t0 = now();
  const at = (want: number) => 575 + 300 * Math.atanh(want / 3); // где курсор, чтобы хотелось повернуть на want
  trackMouse(at(1), 640);
  for (let i = 1; i <= 3; i++) updateCursorWatch(t0 + i * 100);
  assert.equal(cat.head.gaze, 1);
  for (const [i, want] of [[4, 1.6], [5, 0.45], [6, 1.55], [7, 0.4]] as const) {
    trackMouse(at(want), 640);
    updateCursorWatch(t0 + i * 100);
    assert.equal(cat.head.gaze, 1, `cursor wants ${want}`);
  }
});
