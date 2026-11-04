// Уроки про файлы: проверка шагов, переходы, остановка.
import './setup';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { cat } from '../src/renderer/cat/cat';
import { T } from '../src/renderer/core/i18n';
import { check, coach, doneClicked, runScenario, showCoachStep, stopCoach } from '../src/renderer/guide/coach';
import { endGuide } from '../src/renderer/guide/control';
import * as Scenarios from '../src/renderer/guide/scenarios';
import { lessons } from '../src/renderer/panels/lessons';
import { api } from '../src/renderer/core/api';
import { hideBubble } from '../src/renderer/ui/bubble';
import { bubbleText, desk, land, resetDesk, ringShown, settle } from './helpers';

beforeEach(() => {
  resetDesk('darwin');
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});
afterEach(() => {
  endGuide(false);
  mock.timers.reset();
});

const startFilesLesson = async () => {
  runScenario(Scenarios.byId('files-learn'));
  await settle();
};

test('Finder lesson waits for the right folder in Finder, not an unrelated window', async () => {
  assert.equal(await check({ filePlace: 'practice' }), true);
  desk.top = { proc: 'TextEdit', title: 'Мои заметки' };
  assert.equal(await check({ filePlace: 'notes' }), false);
  desk.top = { proc: 'Finder', title: 'Мои заметки' };
  assert.equal(await check({ filePlace: 'notes' }), true);
});

test('folder completion checks Finder even while the cat or another app is in front', async () => {
  api.locate = async (q) => {
    desk.requests.push(q);
    return { win: q.op === 'window' ? { proc: 'Finder', title: 'Мои заметки' } : { proc: 'Electron', title: 'Пушик' } };
  };
  assert.equal(await check({ filePlace: 'notes' }), true);
  assert.equal(desk.requests[0]?.op, 'window');
  assert.equal(desk.requests[0]?.scope, 'proc:^Finder$');
});

test('lesson starts with opening the practice folder; duplicate completion cannot skip a step', async () => {
  await startFilesLesson();
  assert.equal(coach.i, 0);
  assert.equal(coach.steps[0]?.find?.name, 'Мои заметки');
  await doneClicked();
  assert.equal(coach.advancing, false); // папка ещё не открыта
  desk.top = { proc: 'Finder', title: 'Мои заметки' };
  await doneClicked();
  const timer = coach.advance;
  await doneClicked();
  assert.equal(coach.advance, timer, 'second click must not schedule another step');
  assert.equal(coach.i, 0);
  mock.timers.tick(500);
  await settle();
  assert.equal(coach.i, 1);
  await doneClicked();
  assert.equal(coach.i, 1); // «Назад» ещё не нажали
});

test('stopping cancels pending advancement and a delayed lookup cannot resurrect a hint', async () => {
  await startFilesLesson();
  desk.top = { proc: 'Finder', title: 'Мои заметки' };
  await doneClicked();
  stopCoach();
  mock.timers.tick(500);
  await settle();
  assert.equal(coach.i, 0);

  let resolve: (r: { items: [] }) => void = () => {};
  api.locate = () => new Promise((r) => { resolve = r; });
  coach.active = true;
  coach.advancing = false;
  const pending = showCoachStep();
  stopCoach();
  hideBubble();
  resolve({ items: [] });
  await pending;
  assert.equal(bubbleText(), '');
});

test('file lessons live in «Уроки»; downloaded-file goal wins over generic internet search', () => {
  const names = lessons().map((l) => l.name).join('|');
  assert.match(names, /Папки, файлы и поиск/);
  assert.match(names, /Найти скачанный файл/);
  const m = Scenarios.match('найти скачанный файл');
  assert.ok(m && 'match' in m);
  assert.equal(m.id, 'files-downloads');
});

test('a Finder control appearing after navigation shows the ring and the cat jumps to it', async () => {
  await startFilesLesson();
  assert.equal(bubbleText().includes(T('files.missing')), false);
  desk.items = [{ name: 'Мои заметки', type: 'AXStaticText', x: 227, y: 460, w: 96, h: 18, focused: false, enabled: true, proc: 'Finder' }];
  mock.timers.tick(1200); // опрос
  await settle();
  assert.equal(ringShown(), true);
  mock.timers.tick(320);  // кот глянул на кнопку и прыгнул
  assert.equal(cat.state, 'jump');
  land();
  assert.equal(cat.state, 'perch');
  assert.ok(bubbleText().includes(T('files.progress', { n: 1, total: coach.steps.length })));
});
