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

test('facing us, the cat turns its head pixel by pixel after the cursor and swipes at it when it is close', () => {
  cat.x = 500;
  cat.y = 600;
  startCursorWatch(8000, 'front');
  assert.equal(cat.state, 'idle');
  const head = () => { const p = watchPose(now()); assert.ok(typeof p !== 'string'); return p; };
  assert.match(head().watch, /^(wagBlink|blink)SitF$/);
  const t0 = now();
  trackMouse(0, 663);                         // далеко слева, на уровне головы
  updateCursorWatch(t0 + 100);
  assert.equal(head().hx, -1);                // не прыжком, а по пикселю
  for (let i = 2; i <= 5; i++) updateCursorWatch(t0 + i * 100);
  assert.equal(head().hx, -3);
  trackMouse(1200, 663);                      // ушёл вправо: голова идёт через середину
  updateCursorWatch(t0 + 600);
  assert.equal(head().hx, -2);
  trackMouse(575, 663);                       // шевелится у самой морды
  assert.match(String(watchPose(now())), /^swipeSit[LR]$/);
});

test('with the cursor above, the cat sits with its back to us and turns its head pixel by pixel', () => {
  cat.x = 500;
  cat.y = 600;
  trackMouse(575, 100);                       // курсор высоко над котом
  startCursorWatch(8000, 'back');
  assert.equal(cat.watchBack, true);
  const head = () => { const p = watchPose(now()); assert.ok(typeof p !== 'string'); return p; };
  assert.deepEqual([head().hx, head().hy], [0, 0]);
  trackMouse(1200, 100);                      // ушёл вправо вверх
  const t0 = now();                           // голова сдвигается не чаще раза в 80 мс
  for (let i = 1; i <= 5; i++) updateCursorWatch(t0 + i * 100);
  assert.deepEqual([head().hx, head().hy], [3, -1]);
  assert.match(head().watch, /^wag(Sit|Stand)B$/);
});
