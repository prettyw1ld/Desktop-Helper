// Главный процесс: учебные файлы и запасной поиск кнопок на macOS.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { createFileActions } from '../src/main/system/files';
import { MAC_ROLES, MAC_SCRIPT } from '../src/main/system/locate';
import { extraFor, fallbackModel, resolve } from '../src/main/ai/providers';
import { aiKey } from '../src/shared/types';

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
