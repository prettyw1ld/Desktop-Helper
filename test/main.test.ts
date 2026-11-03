// Главный процесс: учебные файлы и запасной поиск кнопок на macOS.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { createFileActions } from '../src/main/system/files';
import { MAC_ROLES, MAC_SCRIPT } from '../src/main/system/locate';

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
