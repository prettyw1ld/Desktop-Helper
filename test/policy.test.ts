// Корпоративный режим: политика организации задаёт модель и закрывает дорогу в облако.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedOrigin, checkUrl, enforce, LOCKED, originAllowed, parsePolicy, parseReg, policyFile, regToRaw } from '../src/main/policy';
import { resolve } from '../src/main/ai/providers';
import type { Settings } from '../src/shared/types';

const cloud = {
  provider: 'groq', aiChosen: true, aiUrl: '', model: 'x', visionModel: 'y', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3',
  apiKey: 'a', groqKey: 'g', deepseekKey: 'd', qwenKey: 'q', voice: 'whisper', sttUrl: 'https://api.groq.com/openai/v1', sttKey: 's', sttModel: 'w',
  userName: 'Аня', catColor: 'black',
} as unknown as Settings;

test('policy: a valid file sets the internal model and the features', () => {
  const p = parsePolicy({ org: 'Отдел ИБ', ai: { url: 'https://llm.corp.local/v1/', model: 'qwen3-vl-8b' }, features: { chat: false } });
  assert.equal(p.problem, '');
  assert.deepEqual(p.ai, { kind: 'openai', url: 'https://llm.corp.local/v1', model: 'qwen3-vl-8b', visionModel: 'qwen3-vl-8b', apiKey: '' });
  assert.deepEqual(p.features, { chat: false, guide: true, inspect: true });
  assert.equal(allowedOrigin(p), 'https://llm.corp.local');
});

test('policy: a broken or unsafe policy turns AI off instead of falling back to the cloud', () => {
  for (const raw of [null, 'text', [], { ai: 'groq' }, { ai: { url: 'ftp://x', model: 'm' } }, { ai: { url: 'https://x' } },
    { ai: { url: 'http://llm.corp.local/v1', model: 'm' } }, { ai: { url: 'https://user:pass@x/v1', model: 'm' } }]) {
    const p = parsePolicy(raw);
    assert.equal(p.ai, null, JSON.stringify(raw));
    assert.notEqual(p.problem, '', JSON.stringify(raw));
  }
  // ИИ выключен намеренно: это не ошибка
  assert.equal(parsePolicy({ org: 'X', ai: null }).problem, '');
  // http: только свой компьютер или явное разрешение
  assert.equal(checkUrl('http://localhost:11434'), 'http://localhost:11434');
  assert.equal(checkUrl('http://10.0.0.5:8000/v1', true), 'http://10.0.0.5:8000/v1');
  assert.equal(parsePolicy({ ai: { kind: 'ollama', url: 'http://127.0.0.1:11434', model: 'qwen3' } }).ai?.kind, 'ollama');
});

test('policy: enforced settings have no cloud keys, no cloud voice, and the model from the policy', () => {
  const p = parsePolicy({ ai: { url: 'https://llm.corp.local/v1', model: 'chat-m', visionModel: 'vision-m', apiKey: 'tok' } });
  const s = enforce(cloud, p);
  assert.deepEqual(resolve(s), { kind: 'openai', url: 'https://llm.corp.local/v1', model: 'chat-m', vision: 'vision-m' });
  assert.deepEqual([s.groqKey, s.deepseekKey, s.qwenKey, s.sttKey, s.sttUrl, s.voice, s.aiChosen], ['', '', '', '', '', 'offline', false]);
  assert.equal(s.apiKey, 'tok');
  assert.equal(s.userName, 'Аня', 'personal settings stay');
  // ИИ выключен политикой: никакого адреса не остаётся
  const off = enforce(cloud, parsePolicy({ ai: null }));
  assert.deepEqual([off.aiUrl, off.model, off.apiKey, off.ollamaUrl], ['', '', '', '']);
  // всё, что задаёт политика, из окна настроек не поменять
  for (const k of ['provider', 'aiUrl', 'model', 'groqKey', 'apiKey', 'voice', 'sttUrl'] as const) assert.ok((LOCKED as readonly string[]).includes(k), k);
});

test('policy: requests go only to the server from the policy', () => {
  const only = allowedOrigin(parsePolicy({ ai: { url: 'https://llm.corp.local/v1', model: 'm' } }));
  assert.equal(originAllowed(only, 'https://llm.corp.local/v1/chat/completions'), true);
  assert.equal(originAllowed(only, 'https://api.groq.com/openai/v1/chat/completions'), false);
  assert.equal(originAllowed(only, 'https://api.anthropic.com/v1/messages'), false);
  assert.equal(originAllowed(only, 'https://llm.corp.local.evil.com/v1'), false);
  assert.equal(originAllowed(null, 'https://llm.corp.local/v1'), false, 'AI is off: nowhere');
  assert.equal(originAllowed(undefined, 'https://api.groq.com/openai/v1'), true, 'no policy: the usual Pushik');
});

test('policy: group policy registry values are read like the file', () => {
  const out = [
    '', 'HKEY_LOCAL_MACHINE\\Software\\Policies\\Pushik',
    '    Org    REG_SZ    Отдел ИБ',
    '    AiUrl    REG_SZ    https://llm.corp.local/v1',
    '    AiModel    REG_SZ    qwen3-vl-8b',
    '    Chat    REG_DWORD    0x0',
    '',
  ].join('\r\n');
  const p = parsePolicy(regToRaw(parseReg(out)));
  assert.equal(p.org, 'Отдел ИБ');
  assert.equal(p.ai?.url, 'https://llm.corp.local/v1');
  assert.equal(p.features.chat, false);
  assert.equal(regToRaw(parseReg('')), null, 'no key: no policy');
  assert.equal(parsePolicy(regToRaw(parseReg('    AiOff    REG_DWORD    0x1'))).ai, null);
  assert.match(policyFile('win32', { ProgramData: 'D:\\PD' }), /PD.Pushik.policy\.json$/);
});
