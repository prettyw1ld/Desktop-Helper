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
import { keepClear, openedZone, pickSpot, targetZones } from '../src/renderer/ui/bubble-spot';
import { repeatAiStep } from '../src/renderer/guide/ai-guide';
import { bubbleText, land, resetDesk, settle } from './helpers';

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

test('guide bubble moves off the button and the menu that opens under it', () => {
  // кнопка «Go» в строке меню слева сверху, кот справа от неё, облачко хотело встать под котом
  const target = { x: 37, y: 38, w: 30, h: 20 };
  const box = { w: 300, h: 330 };
  const spot = pickSpot({ box, preferred: { x: 8, y: 115 }, body: { x: 90, y: 0, w: 100, h: 90 }, zones: targetZones(target, 800), screen: { w: 1280, h: 800 } });
  const zone = keepClear(target, 800);
  const r = { ...spot, ...box };
  assert.equal(overlap(r, zone.target), 0, 'must not cover the button');
  assert.equal(overlap(r, zone.menu), 0, 'must not cover where the menu opens');
  // кнопка внизу (панель задач): меню открывается вверх
  assert.ok(keepClear({ x: 600, y: 760, w: 40, h: 40 }, 800).menu.y < 760);
  // ничего не закрывает — остаётся, где было
  const free = pickSpot({ box, preferred: { x: 700, y: 300 }, body: { x: 650, y: 400, w: 100, h: 90 }, zones: targetZones(target, 800), screen: { w: 1280, h: 800 } });
  assert.deepEqual(free, { x: 700, y: 300 });
  // открылось длинное меню: облачко встаёт рядом и не закрывает ни его, ни кнопку
  const menu = { x: 30, y: 60, w: 330, h: 520 };
  const zones = [openedZone(menu), ...targetZones(target, 800).slice(0, 1)];
  const beside = pickSpot({ box, preferred: { x: 8, y: 115 }, body: { x: 90, y: 0, w: 100, h: 90 }, zones, screen: { w: 1280, h: 800 } });
  assert.equal(overlap({ ...beside, ...box }, menu), 0, 'must not cover the opened menu');
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
  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.mode, 'check');
  assert.equal(calls[2]?.mode, 'more', 'the model said nothing about what opened: ask separately');
  assert.deepEqual(calls[2]?.history, []);
  mock.timers.tick(400);
  land();
  await settle();
  assert.match(bubbleText(), /Нажми «Back»/, 'nothing opened: carry on with the next step');
  assert.deepEqual(calls[1]?.click, { onTarget: true }, 'the model is told the press hit the highlighted button');
  endGuide(false);
  assert.deepEqual(clicks.at(-1), [false, 'guide']);
  assert.deepEqual(focus, [false], 'after the guide the cat still leaves keyboard focus to the program');
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

test('when a menu opens the cat explains it, goes deeper on «Подробнее», then carries on', async () => {
  const opened = '«Go» — меню переходов.\n«Back» — вернуться назад.';
  api.guideLook = async (req) => {
    calls.push(req);
    if (req.mode === 'check') return { ...step('Нажми «Go to File»'), opened, hasMore: true };
    if (req.mode === 'more') return { ...step(''), status: 'explain', target: null, opened: '«Go to File» — открыть файл по имени.', hasMore: false };
    return step('Нажми «Go»');
  };
  await showFirstStep();
  mock.timers.tick(1000);
  onScreenClick({ x: 510, y: 305 });
  mock.timers.tick(1000);
  await settle();
  assert.equal(bubbleText().includes('меню переходов'), true, 'explains what opened instead of the next step');
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('#bubble-actions button')];
  assert.deepEqual(buttons().map((b) => b.textContent), ['Подробнее', 'Понятно']);
  buttons()[0]!.click();
  await settle();
  const more = calls.at(-1)!;
  assert.equal(more.mode, 'more');
  assert.equal(more.level, 2);
  assert.deepEqual(more.history, [opened], 'the model knows what was already told');
  assert.match(bubbleText(), /Go to File/);
  assert.deepEqual(buttons().map((b) => b.textContent), ['Понятно'], 'nothing more to tell');
  buttons()[0]!.click();
  await settle();
  mock.timers.tick(400);
  land();
  await settle();
  assert.match(bubbleText(), /Нажми «Go to File»/, '«Понятно» continues with the next step');
});

test('dragging the cat while it explains the opened menu keeps the explanation, not the old step', async () => {
  api.guideLook = async (req) => {
    calls.push(req);
    if (req.mode === 'check') return { ...step('Нажми в стороне'), opened: '«Go» — меню переходов.', openedBox: { x: 400, y: 320, w: 300, h: 300 } };
    return step('Нажми «Go»');
  };
  await showFirstStep();
  mock.timers.tick(1000);
  onScreenClick({ x: 510, y: 305 });
  mock.timers.tick(1000);
  await settle();
  assert.match(bubbleText(), /меню переходов/);
  assert.equal(calls[1]?.click?.onTarget, true);
  // кота перенесли: после этого облачко показывают заново
  assert.equal(repeatAiStep(), true);
  assert.match(bubbleText(), /меню переходов/);
  assert.doesNotMatch(bubbleText(), /Нажми «Go»/);
  // «Понятно»: следующий шаг показан, а кот не стоит на открытом меню
  const ok = [...document.querySelectorAll<HTMLButtonElement>('#bubble-actions button')].find((b) => b.textContent === 'Понятно')!;
  ok.click();
  for (let i = 0; i < 4; i++) { mock.timers.tick(400); land(); await settle(); }
  assert.match(bubbleText(), /Нажми в стороне/);
});

test('an opened menu becomes item buttons: ask about one item, try it, or go back to the list', async () => {
  const opened = 'Меню «Go» — переходы по коду.\n«Back» — вернуться назад.';
  const items = ['Back', 'Forward', 'Go to File...', 'Go to Line/Column...'];
  api.guideLook = async (req) => {
    calls.push(req);
    if (req.mode === 'check') return { ...step('Нажми «Go to File»'), opened, items };
    if (req.mode === 'more' && req.item) {
      return { ...step(''), status: 'explain', target: null, opened: `«${req.item}» — перейти к строке по номеру (Ctrl+G).`, practiceGoal: 'Перейти к строке 10' };
    }
    return step('Нажми «Go»');
  };
  await showFirstStep();
  mock.timers.tick(1000);
  onScreenClick({ x: 510, y: 305 });
  mock.timers.tick(1000);
  await settle();
  const items$ = () => [...document.querySelectorAll<HTMLButtonElement>('#bubble-actions button.item')].map((b) => b.textContent);
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('#bubble-actions button')];
  const press = (label: string) => buttons().find((b) => b.textContent === label)!.click();
  assert.match(bubbleText(), /переходы по коду/);
  assert.match(bubbleText(), /Про какой пункт рассказать/);
  assert.doesNotMatch(bubbleText(), /вернуться назад/, 'not every item is described at once');
  assert.deepEqual(items$(), items);
  press('Go to Line/Column...');
  await settle();
  assert.equal(calls.at(-1)?.item, 'Go to Line/Column...');
  assert.deepEqual(calls.at(-1)?.history, []);
  assert.match(bubbleText(), /перейти к строке/);
  assert.deepEqual(buttons().map((b) => b.textContent), ['Покажи, как', 'Другой пункт', 'Понятно']);
  press('Другой пункт');
  assert.deepEqual(items$(), items, 'back to the list without asking the AI again');
  press('Про всё сразу');
  assert.match(bubbleText(), /вернуться назад/);
  assert.equal(buttons()[0]?.textContent, 'Подробнее');
  press('Понятно');
  await settle();
  mock.timers.tick(400);
  land();
  await settle();
  assert.match(bubbleText(), /Нажми «Go to File»/);
});

test('«Покажи, как» about one item tells the model that item is open on the screen', async () => {
  api.guideLook = async (req) => {
    calls.push(req);
    if (req.mode === 'check') return { ...step('Нажми «Go to File»'), opened: 'Меню «Go».', items: ['Back', 'Go to Line/Column...'] };
    if (req.mode === 'more' && req.item) return { ...step(''), status: 'explain', target: null, opened: 'Про пункт.', practiceGoal: 'Перейти к строке 10' };
    return step('Нажми «Go»');
  };
  await showFirstStep();
  mock.timers.tick(1000);
  onScreenClick({ x: 510, y: 305 });
  mock.timers.tick(1000);
  await settle();
  const press = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('#bubble-actions button')].find((b) => b.textContent === label)!.click();
  press('Go to Line/Column...');
  await settle();
  press('Покажи, как');
  await settle();
  const req = calls.at(-1)!;
  assert.equal(req.mode, 'practice');
  assert.equal(req.goal, 'Перейти к строке 10');
  assert.equal(req.item, 'Go to Line/Column...');
});

test('a small window without a list (Go to line) opens: the cat goes straight to the next step inside it', async () => {
  api.guideLook = async (req) => {
    calls.push(req);
    if (req.mode === 'check') {
      return { ...step('Напиши «1» в окошке'), target: { x: 600, y: 140, w: 500, h: 26 }, openedBox: { x: 400, y: 120, w: 900, h: 500 }, items: ['Type a line number'] };
    }
    return step('Нажми «Go»');
  };
  await showFirstStep();
  mock.timers.tick(1000);
  onScreenClick({ x: 510, y: 305 });
  mock.timers.tick(1000);
  await settle();
  assert.equal(calls.length, 2, 'no separate question about what opened');
  for (let i = 0; i < 3; i++) { mock.timers.tick(400); land(); await settle(); }
  assert.match(bubbleText(), /Напиши «1»/);
});
