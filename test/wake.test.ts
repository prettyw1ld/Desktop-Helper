// «Пушик!»: кот узнаёт своё имя, слушает просьбу и отвечает в чате. Микрофона в тестах нет,
// поэтому уши подменяем: тест сам говорит коту, что тот услышал.
import './setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ears, syncWake } from '../src/renderer/app/wake';
import { api } from '../src/renderer/core/api';
import { dom, isHidden, $ } from '../src/renderer/core/dom';
import { setSettings, settings } from '../src/renderer/core/settings';
import { heardName, stripName } from '../src/renderer/core/wake';
import type { EarHooks } from '../src/renderer/core/wake';
import { hideBubble } from '../src/renderer/ui/bubble';
import { closePanels, openPanel } from '../src/renderer/ui/panels';
import { resetDesk, settle } from './helpers';

test('the name is recognised in how the small model hears «Пушик», ordinary words are not', () => {
  for (const t of ['пушок', 'привет пушок', 'пушкин', '[unk] пушки']) assert.ok(heardName(t), t);
  for (const t of ['', '[unk]', 'пушистый хвост', 'опушка леса', 'пущу']) assert.ok(!heardName(t), t);
});

test('the request loses the name at the start and «[unk]» noise', () => {
  assert.equal(stripName('пущу открой почту'), 'открой почту');
  assert.equal(stripName('[unk] пушок как позвонить внуку'), 'как позвонить внуку');
  assert.equal(stripName('спущусь'), '');
  assert.equal(stripName('пушок'), '');
  assert.equal(stripName('как отправить фото [unk]'), 'как отправить фото');
});

function fakeEars(fail?: Error) {
  const log = { hooks: null as EarHooks | null, started: 0, stopped: 0 };
  ears.start = async (h) => {
    log.started++;
    if (fail) throw fail;
    log.hooks = h;
    return { stop: () => { log.stopped++; } };
  };
  return log;
}

const badge = () => $('#ear');
const bubbleText = () => dom.bubbleText.textContent ?? '';

function setup(over: Partial<typeof settings> = {}): void {
  resetDesk('win32');
  setSettings({ ...settings, wakeWord: false });
  syncWake(); // уши от прошлого теста выключаем
  setSettings({ ...settings, hasVosk: true, aiReady: true, ...over });
  syncWake();
  closePanels();
  hideBubble();
}

test('wake word: off by default, turning it on shows the listening badge, turning it off stops the microphone', async () => {
  const ear = fakeEars();
  setup();
  assert.equal(ear.started, 0, 'microphone is not opened without consent');
  assert.ok(isHidden(badge()));

  setSettings({ ...settings, wakeWord: true });
  syncWake();
  await settle();
  assert.equal(ear.started, 1);
  assert.ok(!isHidden(badge()), 'the person sees that the cat is listening');

  setSettings({ ...settings, wakeWord: false });
  syncWake();
  assert.equal(ear.stopped, 1);
  assert.ok(isHidden(badge()));
});

test('«Пушик, …»: the cat answers, shows what it hears and asks the chat', async () => {
  const ear = fakeEars();
  setup({ wakeWord: true });
  await settle();
  const asked: string[] = [];
  api.chat = async (t) => { asked.push(t); return { reply: 'Сейчас расскажу', actions: [] }; };

  assert.equal(ear.hooks!.onName(), true);
  assert.match(bubbleText(), /Слушаю/);
  assert.ok(badge().classList.contains('hearing'));
  assert.equal(ear.hooks!.onName(), false, 'a second «Пушик» while listening is ignored');

  ear.hooks!.onPartial('какая сегодня');
  assert.match(bubbleText(), /какая сегодня/);
  ear.hooks!.onPhrase('какая сегодня погода');
  await settle();

  assert.deepEqual(asked, ['какая сегодня погода']);
  assert.equal(openPanel(), 'chat');
  const log = $('#chat-log').textContent ?? '';
  assert.match(log, /какая сегодня погода/);
  assert.match(log, /Сейчас расскажу/);
  assert.ok(!badge().classList.contains('hearing'));
  assert.equal(ear.hooks!.onName(), true, 'after the answer the cat can be called again');
  ear.hooks!.onPhrase('');
  assert.match(bubbleText(), /ничего не расслышал/);
  assert.equal(openPanel(), 'chat');
});

test('no microphone: the cat says so once and does not retry until the setting is turned on again', async () => {
  const ear = fakeEars(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  setup({ wakeWord: true });
  await settle();
  assert.equal(ear.started, 1);
  assert.match(bubbleText(), /микрофон/);
  assert.ok(isHidden(badge()));
  syncWake();
  await settle();
  assert.equal(ear.started, 1);

  setSettings({ ...settings, wakeWord: false });
  syncWake();
  setSettings({ ...settings, wakeWord: true });
  syncWake();
  await settle();
  assert.equal(ear.started, 2);
});

test('without the offline voice model the microphone stays off', async () => {
  const ear = fakeEars();
  setup({ wakeWord: true, hasVosk: false });
  await settle();
  assert.equal(ear.started, 0);
  assert.ok(isHidden(badge()));
});
