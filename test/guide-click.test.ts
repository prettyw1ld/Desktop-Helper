// «Покажи, как»: кот сам проверяет шаг после нажатия мышью и не закрывает облачком кнопку и меню.
import './setup';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { LookRequest, LookResult } from '../src/shared/types';
import { api } from '../src/renderer/core/api';
import { setSettings, settings } from '../src/renderer/core/settings';
import { onScreenClick, startGuide } from '../src/renderer/guide/ai-guide';
import { endGuide } from '../src/renderer/guide/control';
import { guide } from '../src/renderer/guide/state';
import { keepClear, pickSpot } from '../src/renderer/ui/bubble-spot';
import { land, resetDesk, settle } from './helpers';

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

test('guide bubble moves off the button and the menu that opens under it', () => {
  // кнопка «Go» в строке меню слева сверху, кот справа от неё, облачко хотело встать под котом
  const target = { x: 37, y: 38, w: 30, h: 20 };
  const box = { w: 300, h: 330 };
  const spot = pickSpot({ box, preferred: { x: 8, y: 115 }, body: { x: 90, y: 0, w: 100, h: 90 }, target, screen: { w: 1280, h: 800 } });
  const zone = keepClear(target, 800);
  const r = { ...spot, ...box };
  assert.equal(overlap(r, zone.target), 0, 'must not cover the button');
  assert.equal(overlap(r, zone.menu), 0, 'must not cover where the menu opens');
  // кнопка внизу (панель задач): меню открывается вверх
  assert.ok(keepClear({ x: 600, y: 760, w: 40, h: 40 }, 800).menu.y < 760);
  // ничего не закрывает — остаётся, где было
  const free = pickSpot({ box, preferred: { x: 700, y: 300 }, body: { x: 650, y: 400, w: 100, h: 90 }, target, screen: { w: 1280, h: 800 } });
  assert.deepEqual(free, { x: 700, y: 300 });
});

const calls: LookRequest[] = [];
const clicks: [boolean, string | undefined][] = [];
const focus: boolean[] = [];
const step = (say: string): LookResult => ({
  status: 'step', screenSummary: '', whatChanged: '', say, explain: '', skill: '', practiceGoal: '',
  target: { x: 500, y: 300, w: 40, h: 20 }, snapped: true,
});

beforeEach(() => {
  resetDesk('win32');
  setSettings({ ...settings, shotConsent: true });
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  calls.length = 0;
  clicks.length = 0;
  focus.length = 0;
  api.guideLook = async (req) => { calls.push(req); return step(calls.length === 1 ? 'Нажми «Go»' : 'Нажми «Back»'); };
  api.watchClicks = (on, key) => { clicks.push([on, key]); };
  api.setFocusable = (on) => { focus.push(on); };
  api.guideWatch = () => {};
  api.guideUnwatch = () => {};
});
afterEach(() => {
  endGuide(false);
  mock.timers.reset();
});

async function showFirstStep(): Promise<void> {
  startGuide('Открыть меню Go');
  await settle();
  mock.timers.tick(400); // кот глянул на кнопку и прыгнул
  land();
  await settle();
  assert.equal(calls.length, 1);
}

test('a click anywhere outside the cat checks the step by itself', async () => {
  await showFirstStep();
  assert.deepEqual(clicks.at(-1), [true, 'guide']);
  assert.deepEqual(focus, [false], 'bubble clicks must not take focus from the program');
  mock.timers.tick(1000);
  onScreenClick({ x: 510, y: 305 }); // нажал «Go»
  mock.timers.tick(1000);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.mode, 'check');
  assert.deepEqual(calls[1]?.click, { onTarget: true }, 'the model is told the press hit the highlighted button');
  endGuide(false);
  assert.deepEqual(clicks.at(-1), [false, 'guide']);
  assert.deepEqual(focus, [false, true]);
});

test('clicks on the cat or its bubble do not count as an action', async () => {
  await showFirstStep();
  mock.timers.tick(1000);
  const bubble = document.getElementById('bubble')!;
  const orig = document.elementFromPoint;
  document.elementFromPoint = () => bubble;
  try {
    onScreenClick({ x: 10, y: 10 });
  } finally {
    document.elementFromPoint = orig;
  }
  mock.timers.tick(2000);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(guide.active, true);
});
