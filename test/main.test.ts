// Главный процесс: учебные файлы и запасной поиск кнопок на macOS.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { createFileActions } from '../src/main/system/files';
import { parseProcessList, remoteApps } from '../src/main/system/remote-watch';
import { MAC_ROLES, MAC_SCRIPT, WIN_SCRIPT } from '../src/main/system/locate';
import { extraFor, fallbackModel, resolve } from '../src/main/ai/providers';
import { cleanPlan, formatMarks, pickMark, refineCrop, showGoal, stepOf, boxUnits, withTaskbar, type Mark } from '../src/main/ai/show';
import { overlayBounds, toFrame, workInFrame } from '../src/main/geometry';
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
  const folder = { ...props('', 96, 18), role: () => 'AXTextField', description: () => '', title: () => '', value: () => 'Мои заметки', focused: () => false };
  const actual = { ...props('Пушик — учимся работать с файлами', 920, 464), entireContents: () => [folder] };
  const proc = { name: () => 'Finder', windows: () => [props('Window', 52, 20), actual] };
  const q = { op: 'find' as const, scope: 'proc:^Finder$', firstWindow: true, name: 'Мои заметки', roles: MAC_ROLES.ListItem ?? [] };
  const c = vm.createContext({ Application: () => ({ processes: { whose: () => () => [proc] } }), ObjC: { import() {} } });
  vm.runInContext(MAC_SCRIPT(q, 1), c);
  const reply: unknown = vm.runInContext('run()', c);
  assert.equal(typeof reply, 'string');
  const result = JSON.parse(reply as string);
  assert.equal(result.win.title, 'Пушик — учимся работать с файлами');
  assert.equal(result.items[0].name.trim(), 'Мои заметки');
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
  assert.equal(pickMark([b], undefined, 'Таймер', { x: 110, y: 95, w: 70, h: 40 }), b, 'far from the AI box but the only one');
  assert.equal(pickMark([a, b], undefined, 'Таймер', { x: 500, y: 350, w: 20, h: 20 }), null, 'two far candidates: do not guess');
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

test('the cat window covers the taskbar, so a taskbar button is highlighted where it really is', () => {
  const bounds = { x: 0, y: 0, width: 1883, height: 1059 };
  const work = { x: 0, y: 0, width: 1883, height: 1012 };
  // «Поиск» у Дамира: 675,1040 220x32 в пикселях экрана → 661,1020 в точках (масштаб 1.02)
  assert.deepEqual(toFrame({ x: 661.8, y: 1019.6, w: 215.7, h: 31.4 }, bounds), { x: 662, y: 1020, w: 216, h: 31 });
  assert.equal(toFrame({ x: 2100, y: 300, w: 50, h: 40 }, bounds), null, 'second monitor');
  assert.deepEqual(toFrame({ x: 2100, y: 300, w: 50, h: 40 }, bounds, true), { x: 2100, y: 300, w: 50, h: 40 });
  assert.deepEqual(workInFrame(work, bounds), { x: 0, y: 0, w: 1883, h: 1012 }, 'the cat still walks above the taskbar');
  assert.deepEqual(overlayBounds(bounds), { x: 0, y: 0, width: 1883, height: 1058 }, 'one pixel short of full screen');
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

test('Windows locator runs from a script file, so its size never hits the command-line limit', async () => {
  const src = await fsp.readFile(path.join(__dirname, '../../src/main/system/locate.ts'), 'utf8');
  assert.doesNotMatch(src, /'-EncodedCommand'/, 'the locator script is too long for -EncodedCommand (32 767 chars on Windows)');
  assert.match(src, /'-File', scriptFile\(\)/);
  const ps = WIN_SCRIPT(1);
  for (const op of ['shot', 'grid', 'list']) assert.match(ps, new RegExp(`\\$q\\.op -eq '${op}'`));
});

test('zoom-in crop for refining the AI box stays around the guess and inside the screen', () => {
  // поле поиска в «Пуске» у Дамира: рамка ИИ в полном снимке 1920×1080
  const c = refineCrop({ x: 951, y: 521, w: 484, h: 26 }, 1920, 1080);
  assert.deepEqual(c, { x: 743, y: 344, w: 900, h: 380 });
  const edge = refineCrop({ x: 1900, y: 1060, w: 20, h: 20 }, 1920, 1080);
  assert.deepEqual(edge, { x: 1360, y: 700, w: 560, h: 380 }, 'clamped to the corner');
});

test('Start menu and Search are found by window class, not among UI Automation root children', () => {
  const ps = WIN_SCRIPT(1);
  // Windows 11 держит «Пуск» и поиск в особом слое окон: RootElement их не показывает
  assert.match(ps, /FindWindowEx\(IntPtr\.Zero, h, "Windows\.UI\.Core\.CoreWindow", null\)/);
  assert.doesNotMatch(ps, /RootElement\.FindAll\(\$TS::Children, \$cond\)/);
  const list = ps.slice(ps.indexOf('function ListAll'), ps.indexOf('function Volume'));
  assert.match(list, /\[PushTop\]::Immersive\(\)/);
  const find = ps.slice(ps.indexOf('function Find'), ps.indexOf('function ListAll'));
  assert.match(find, /\$root\[1\] -ne 'start' -and \$root\[1\] -ne 'popup' -and -not \(Visible/, 'point check skips the top layer');
});

test('taskbar buttons stay pointable while Start hides them from UI Automation', () => {
  const it = (name: string, area: string) => ({ name, type: 'Button', area, x: 0, y: 0, w: 10, h: 10, enabled: true, focused: false, proc: '' });
  const closed = withTaskbar([it('Пуск', 'taskbar'), it('Поиск', 'taskbar')], 1000);
  assert.equal(closed.length, 2);
  const open = withTaskbar([it('Часы', 'popup')], 2000);
  assert.deepEqual(open.map((x) => x.name), ['Пуск', 'Поиск', 'Часы']);
  assert.equal(withTaskbar([it('Часы', 'popup')], 2000 + 11 * 60_000).length, 1, 'old taskbar is forgotten');
});

test('remote-watch: замечает программы удалённого доступа по именам процессов', () => {
  const win = '"System Idle Process","0","Services","0","8 K"\r\n"AnyDesk.exe","4120","Console","1","20 000 K"\r\n"TeamViewer_Service.exe","900","Services","0","9 000 K"\r\n';
  const procs = parseProcessList(win, 'win32');
  assert.deepEqual(procs, ['System Idle Process', 'AnyDesk.exe', 'TeamViewer_Service.exe']);
  // служба TeamViewer сама по себе не тревога: только окно программы
  assert.deepEqual(remoteApps(procs), ['AnyDesk']);
  assert.deepEqual(remoteApps(parseProcessList('launchd\nTeamViewer\nrustdesk\n', 'darwin')), ['TeamViewer', 'RustDesk']);
  assert.deepEqual(remoteApps(['chrome.exe', 'explorer.exe']), []);
});
