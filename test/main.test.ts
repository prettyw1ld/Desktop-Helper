// Главный процесс: учебные файлы и запасной поиск кнопок на macOS.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { createFileActions } from '../src/main/system/files';
import { MAC_ROLES, MAC_SCRIPT, WIN_SCRIPT } from '../src/main/system/locate';
import { extraFor, fallbackModel, resolve } from '../src/main/ai/providers';
import { cleanPlan, formatMarks, pickMark, showGoal, stepOf, boxUnits, type Mark } from '../src/main/ai/show';
import { fitToWorkArea } from '../src/main/geometry';
import { aiKey } from '../src/shared/types';
import { goalFromHowTo, isHowTo, vagueGoal } from '../src/shared/howto';

test('practice files survive repeated setup; folder actions reject arbitrary paths; picker cancel does not open', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pushik-files-test-'));
  const opened: string[] = [];
  const action = createFileActions({
    app: { getPath: () => dir },
    shell: { openPath: async (p: string) => { opened.push(p); return ''; }, openExternal: async () => {} },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    platform: 'win32',
  });
  try {
    assert.equal((await action({ op: 'open', place: 'practice' })).ok, true);
    const file = path.join(opened[0]!, 'Привет от Пушика.txt');
    await fsp.writeFile(file, 'learner edit');
    await action({ op: 'open', place: 'practice' });
    assert.equal(await fsp.readFile(file, 'utf8'), 'learner edit');
    const count = opened.length;
    assert.ok((await action({ op: 'open', place: '../../private' as 'practice' })).error);
    assert.equal((await action({ op: 'choose' })).canceled, true);
    assert.equal(opened.length, count);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('macOS fallback returns JSON from its run handler and skips the sharing control window', () => {
  const props = (title: string, w: number, h: number) => ({
    name: () => title, position: () => [188, 188], size: () => [w, h], attributes: { byName: () => ({ value: () => false }) },
  });
  const folder = { ...props('', 96, 18), role: () => 'AXTextField', description: () => '', title: () => '', value: () => 'Мои открытки', focused: () => false };
  const actual = { ...props('Пушик — учимся работать с файлами', 920, 464), entireContents: () => [folder] };
  const proc = { name: () => 'Finder', windows: () => [props('Window', 52, 20), actual] };
  const q = { op: 'find' as const, scope: 'proc:^Finder$', firstWindow: true, name: 'Мои открытки', roles: MAC_ROLES.ListItem ?? [] };
  const c = vm.createContext({ Application: () => ({ processes: { whose: () => () => [proc] } }), ObjC: { import() {} } });
  vm.runInContext(MAC_SCRIPT(q, 1), c);
  const reply: unknown = vm.runInContext('run()', c);
  assert.equal(typeof reply, 'string');
  const result = JSON.parse(reply as string);
  assert.equal(result.win.title, 'Пушик — учимся работать с файлами');
  assert.equal(result.items[0].name.trim(), 'Мои открытки');
  assert.equal(result.items[0].type, 'AXTextField');
});

test('each AI model goes to its own service with its own key; thinking is switched off where it slows answers', () => {
  const base = { aiUrl: '', model: 'claude-sonnet-5-5', visionModel: '' };
  assert.deepEqual(resolve({ ...base, provider: 'deepseek' }),
    { kind: 'openai', url: 'https://api.deepseek.com', model: 'deepseek-flash', vision: 'deepseek-flash' });
  assert.deepEqual(resolve({ ...base, provider: 'qwen' }),
    { kind: 'openai', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', vision: 'qwen3.8-flash' });
  const groq = resolve({ ...base, provider: 'groq' });
  assert.ok(groq.kind === 'openai' && groq.vision === 'qwen/qwen3.8-27b');

  assert.deepEqual(extraFor('deepseek-flash', 'https://api.deepseek.com'), { thinking: { type: 'disabled' } });
  assert.deepEqual(extraFor('qwen3.8-flash', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'), { enable_thinking: false });
  assert.deepEqual(extraFor('openai/gpt-oss-120b', 'https://api.groq.com/openai/v1'), { reasoning_effort: 'low' });

  // нужной модели у ключа нет: берём самую новую flash, а не первую попавшуюся
  assert.equal(fallbackModel(['qwen-max', 'qwen3.7-flash', 'qwen-flash', 'qwen3.8-flash-0901'], 'qwen3.8-flash', true), 'qwen3.7-flash');
  assert.equal(fallbackModel(['deepseek-flash', 'deepseek-v4-pro'], 'deepseek-flash', true), 'deepseek-flash');

  const keys = { apiKey: 'claude-key', groqKey: 'gsk', deepseekKey: 'sk-ds', qwenKey: '' };
  assert.equal(aiKey({ ...keys, provider: 'deepseek' }), 'sk-ds');
  assert.equal(aiKey({ ...keys, provider: 'qwen' }), '');          // без своего ключа Qwen не берёт чужой
  assert.equal(aiKey({ ...keys, provider: 'claude' }), 'claude-key');
});

test('chat "how do I…" answers turn into an on-screen walkthrough goal', () => {
  assert.equal(showGoal('[SHOW] Поставить таймер на 5 минут в приложении Часы.'), 'Поставить таймер на 5 минут в приложении Часы.');
  assert.equal(showGoal('Мур! [ПОКАЖУ]: Сделать «звук» громче\nещё строка'), 'Сделать звук громче');
  assert.equal(showGoal('Привет! Как дела?'), '');
});

test('walkthrough plan: steps are cleaned and "step N of M" only shows for a valid step', () => {
  const plan = cleanPlan(['1. Нажми «Пуск»', '', '2) Напиши «часы»', 'Открой «Часы»', 42]);
  assert.deepEqual(plan, ['Нажми «Пуск»', 'Напиши «часы»', 'Открой «Часы»', '42']);
  assert.deepEqual(cleanPlan('не список'), []);
  assert.equal(stepOf(2, plan), 2);
  assert.equal(stepOf('3', plan), 3);
  assert.equal(stepOf(7, plan), 0);
  assert.equal(stepOf(undefined, plan), 0);
});

test('precise paw: the AI picks a system element by number; otherwise the named one nearest to its box', () => {
  const mk = (id: number, name: string, x: number, y: number): Mark => ({ id, name, type: 'Button', area: 'taskbar', shot: { x, y, w: 80, h: 30 }, overlay: { x, y, w: 80, h: 30 } });
  const a = mk(1, 'Таймер', 100, 100);
  const b = mk(2, 'Таймер', 900, 600);
  const c = mk(3, 'Поиск', 120, 140);
  assert.equal(pickMark([a, b, c], 3), c, 'number wins');
  assert.equal(pickMark([a, b, c], '2'), b);
  assert.equal(pickMark([a, b, c], 99, 'Таймер', { x: 110, y: 95, w: 70, h: 40 }), a, 'bad number: nearest by name');
  assert.equal(pickMark([b], undefined, 'Таймер', { x: 110, y: 95, w: 70, h: 40 }), null, 'too far from the AI box');
  assert.equal(pickMark([a, b], undefined, '«Таймер»'), null, 'two with that name and no box');
  assert.equal(pickMark([a, c], undefined, 'таймер'), a);
  assert.equal(pickMark([a], undefined, ''), null);
  const text = formatMarks([c]);
  assert.match(text, /\[3\] Button "Поиск" \(taskbar\) at 120,140 size 80x30/);
  assert.match(formatMarks([]), /target/);
  // снимок 1024×576: рамка ниже 576 бывает только в долях 0..1000
  assert.equal(boxUnits({ x: 100, y: 880, w: 120, h: 40 }, 1024, 576), 'k');
  assert.equal(boxUnits({ x: 100, y: 500, w: 120, h: 40 }, 1024, 576), 'px');
  assert.equal(boxUnits({ x: 1100, y: 500, w: 120, h: 40 }, 1024, 576), 'px');
});

test('buttons on the taskbar are shown at the edge of the cat window, other monitors are skipped', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1032 };
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(fitToWorkArea({ x: 100, y: 200, w: 50, h: 40 }, wa, bounds), { x: 100, y: 200, w: 50, h: 40 });
  // «Поиск» на панели задач внизу: полоска у нижнего края окна прямо над кнопкой
  assert.deepEqual(fitToWorkArea({ x: 110, y: 1040, w: 210, h: 36 }, wa, bounds), { x: 110, y: 1004, w: 210, h: 28 });
  assert.equal(fitToWorkArea({ x: 2100, y: 300, w: 50, h: 40 }, wa, bounds), null, 'second monitor');
  assert.deepEqual(fitToWorkArea({ x: 2100, y: 300, w: 50, h: 40 }, wa, bounds, true), { x: 2100, y: 300, w: 50, h: 40 });
});

test('"show me how…" requests are recognised without the AI; small talk is not', () => {
  const howTo = [
    'покажи как поставить таймер на 5 минут',
    'а ты можешь мне объяснить как это сделать и показать?',
    'Как мне открыть калькулятор?',
    'как сделать звук громче',
    'хочу позвонить внуку',
    'где найти мои загрузки',
    'научи отправлять фото',
    'how do I open the calculator',
  ];
  for (const t of howTo) assert.equal(isHowTo(t), true, t);
  for (const t of ['как дела?', 'Как тебя зовут', 'расскажи сказку', 'напомни через 20 минут позвонить маме', 'привет', 'спасибо!']) {
    assert.equal(isHowTo(t), false, t);
  }
  assert.equal(goalFromHowTo('покажи как поставить таймер на 5 минут'), 'Поставить таймер на 5 минут');
  assert.equal(goalFromHowTo('Покажи мне, пожалуйста, как открыть калькулятор?'), 'Открыть калькулятор');
  assert.equal(goalFromHowTo('хочу позвонить внуку'), 'Хочу позвонить внуку');
  assert.equal(vagueGoal(goalFromHowTo('а ты можешь мне объяснить как это сделать и показать?')), true);
  assert.equal(vagueGoal(goalFromHowTo('покажи как поставить таймер на 5 минут')), false);
});

test('Windows locator lists screen elements within a time budget and its script stays balanced', () => {
  const ps = WIN_SCRIPT(1);
  assert.match(ps, /elseif \(\$q\.op -eq 'list'\) \{ \$res = ListAll \$q \}/);
  const fn = ps.slice(ps.indexOf('function ListAll'), ps.indexOf('function Volume'));
  assert.match(fn, /Stopwatch/);
  for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']] as const) {
    assert.equal(fn.split(o).length, fn.split(c).length, `balanced ${o}${c}`);
  }
  assert.match(fn, /-replace 'ControlType\\\.'/, 'regex escape survives the template string');
});
