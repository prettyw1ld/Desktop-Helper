// Run with: node --test tools/test-file-help.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function coachHarness() {
  const timers = new Map(); let sequence = 0;
  const element = () => ({ addEventListener() {}, appendChild() {}, textContent: '' });
  const status = element();
  const c = vm.createContext({
    window: {}, document: { querySelector: () => status, querySelectorAll: () => [], createElement: element },
    settings: { platform: 'darwin', locator: true }, guide: {}, cat: { state: 'busy' },
    I18N: { lang: 'ru', list: () => ['checking'] }, T: (s) => s, pick: (a) => a[0],
    api: { locate: async (q) => (q.op === 'top' || q.op === 'window') ? { win: c.top } : { items: c.items || [] }, filesAction: async () => ({ trusted: true, ok: true }) },
    top: { proc: 'Finder', title: 'Пушик — учимся работать с файлами' },
    say: (...args) => { c.bubble = args; }, speak() {}, showRing() {}, hideRing() {}, goPoint: (_, cb) => cb?.(),
    Sound: { meow() {} }, happy() {}, celebrate() {}, startFall() {}, closePanels() {}, endTrainer() {},
    endGuide() {}, imLost() {}, showPanel: (name) => { c.panel = name; },
    setTimeout: (fn) => { timers.set(++sequence, fn); return sequence; }, clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => { timers.set(++sequence, fn); return sequence; }, clearInterval: (id) => timers.delete(id),
  });
  vm.runInContext(fs.readFileSync('src/renderer/scenarios.js', 'utf8'), c);
  c.Scenarios = c.window.Scenarios;
  vm.runInContext(fs.readFileSync('src/renderer/coach.js', 'utf8'), c);
  return { c, run: (code) => vm.runInContext(code, c), timers };
}

test('Finder lesson waits for the right folder in Finder, not an unrelated window', async () => {
  const { c, run } = coachHarness();
  assert.equal(await run("check({filePlace:'practice'}, {})"), true);
  c.top = { proc: 'TextEdit', title: 'Мои открытки' };
  assert.equal(await run("check({filePlace:'postcards'}, {})"), false);
  c.top = { proc: 'Finder', title: 'Мои открытки' };
  assert.equal(await run("check({filePlace:'postcards'}, {})"), true);
});

test('manual introduction remains visible; duplicate completion cannot skip a lesson step', async () => {
  const { run, timers } = coachHarness();
  run("runScenario(Scenarios.list.find(s => s.id === 'files-learn'))");
  await new Promise(setImmediate);
  assert.equal(run('coach.i'), 0);
  await run('doneClicked()');
  const timer = run('coach.advance');
  await run('doneClicked()');
  assert.equal(run('coach.advance'), timer);
  assert.equal(run('coach.i'), 0);
  await timers.get(timer)();
  assert.equal(run('coach.i'), 1);
  await run('doneClicked()');
  assert.equal(run('coach.i'), 1); // folder has not been opened
  run('stopCoach()');
});

test('stopping cancels pending advancement and a delayed lookup cannot resurrect a hint', async () => {
  const { c, run, timers } = coachHarness();
  run("runScenario(Scenarios.list.find(s => s.id === 'files-learn'))");
  await new Promise(setImmediate);
  await run('doneClicked()');
  const timer = run('coach.advance');
  run('stopCoach()');
  assert.equal(timers.has(timer), false);
  let resolve;
  c.api.locate = () => new Promise((r) => { resolve = r; });
  run('coach.active = true; coach.advancing = false');
  const pending = run('showCoachStep()');
  run('stopCoach()'); c.bubble = null;
  resolve({ win: c.top }); await pending;
  assert.equal(c.bubble, null);
});

test('file menu routes separately; downloaded-file goal wins over generic internet search', () => {
  const { c, run } = coachHarness();
  run("routeGoal('📁 Помоги с файлами')");
  assert.equal(c.panel, 'files');
  assert.equal(run("Scenarios.match('найти скачанный файл').id"), 'files-downloads');
});

test('practice files survive repeated setup; folder actions reject arbitrary paths; picker cancel does not open', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pushik-files-test-'));
  const opened = [];
  const electron = {
    app: { getPath: () => dir }, shell: { openPath: async (p) => { opened.push(p); return ''; } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  };
  const c = vm.createContext({ module: { exports: {} }, require: (name) => name === 'electron' ? electron : require(name), process });
  vm.runInContext(fs.readFileSync('src/files.js', 'utf8'), c);
  const { action } = c.module.exports;
  try {
    assert.equal((await action({ op: 'open', place: 'practice' })).ok, true);
    const file = path.join(opened[0], 'Привет от Пушика.txt');
    await fsp.writeFile(file, 'learner edit');
    await action({ op: 'open', place: 'practice' });
    assert.equal(await fsp.readFile(file, 'utf8'), 'learner edit');
    const count = opened.length;
    assert.ok((await action({ op: 'open', place: '../../private' })).error);
    assert.equal((await action({ op: 'choose' })).canceled, true);
    assert.equal(opened.length, count);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('folder completion checks Finder even while the coach or another app is in front', async () => {
  const { c, run } = coachHarness();
  const requests = [];
  c.api.locate = async (q) => {
    requests.push(q);
    return { win: q.op === 'window' ? { proc: 'Finder', title: 'Мои открытки' } : { proc: 'Electron', title: 'Пушик' } };
  };
  assert.equal(await run("check({filePlace:'postcards'}, {})"), true);
  assert.equal(requests[0].op, 'window');
  assert.equal(requests[0].scope, 'proc:^Finder$');
});

test('a Finder control appearing after navigation triggers both the ring and the cat jump', async () => {
  const { c, run, timers } = coachHarness();
  let rings = 0; let jumps = 0;
  c.showRing = () => rings++;
  c.goPoint = (_, cb) => { jumps++; cb?.(); };
  run("runScenario(Scenarios.list.find(s => s.id === 'files-learn'))");
  await new Promise(setImmediate);
  assert.equal(c.bubble[2].explain.includes('files.missing'), false);
  c.items = [{ name: 'Downloads', type: 'AXStaticText', x: 227, y: 460, w: 96, h: 18 }];
  await timers.get(run('coach.poll'))();
  assert.equal(rings, 1);
  assert.equal(jumps, 1);
  assert.ok(c.bubble[0].includes('files.progress'));
  run('stopCoach()');
});

test('macOS fallback returns JSON from its run handler and skips the sharing control window', () => {
  const { _MAC_SCRIPT, _MAC_ROLES } = require('../src/locate');
  const props = (title, w, h) => ({ name: () => title, position: () => [188, 188], size: () => [w, h], attributes: { byName: () => ({ value: () => false }) } });
  const folder = { ...props('', 96, 18), role: () => 'AXTextField', description: () => '', title: () => '', value: () => 'Мои открытки', focused: () => false };
  const actual = { ...props('Пушик — учимся работать с файлами', 920, 464), entireContents: () => [folder] };
  const proc = { name: () => 'Finder', windows: () => [props('Window', 52, 20), actual] };
  const q = { op: 'find', scope: 'proc:^Finder$', firstWindow: true, name: 'Мои открытки', roles: _MAC_ROLES.ListItem };
  const c = vm.createContext({ Application: () => ({ processes: { whose: () => () => [proc] } }), ObjC: { import() {} } });
  vm.runInContext(_MAC_SCRIPT(q, 1), c);
  const reply = vm.runInContext('run()', c);
  assert.equal(typeof reply, 'string');
  const result = JSON.parse(reply);
  assert.equal(result.win.title, 'Пушик — учимся работать с файлами');
  assert.equal(result.items[0].name.trim(), 'Мои открытки');
  assert.equal(result.items[0].type, 'AXTextField');
});
