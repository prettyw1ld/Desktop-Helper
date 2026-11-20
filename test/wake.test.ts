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
import { nameWords } from '../src/shared/cat-name';
import type { EarHooks } from '../src/renderer/core/wake';
import { hideBubble } from '../src/renderer/ui/bubble';
import { applySettings } from '../src/renderer/panels/settings';
import { closePanels, openPanel } from '../src/renderer/ui/panels';
import { resetDesk, settle } from './helpers';

const PUSHIK = nameWords('Пушик', []);

test('the name is recognised in how the small model hears «Пушик», ordinary words are not', () => {
  for (const t of ['пушок', 'привет пушок', 'пушкин', '[unk] пушки']) assert.ok(heardName(t, PUSHIK), t);
  for (const t of ['', '[unk]', 'пушистый хвост', 'опушка леса', 'пущу']) assert.ok(!heardName(t, PUSHIK), t);
  assert.ok(heardName('барсик', ['барсик']));
});

test('the request loses the name at the start and «[unk]» noise', () => {
  assert.equal(stripName('пущу открой почту', 'Пушик', PUSHIK), 'открой почту');
  assert.equal(stripName('[unk] пушок как позвонить внуку', 'Пушик', PUSHIK), 'как позвонить внуку');
  assert.equal(stripName('спущусь', 'Пушик', PUSHIK), '');
  assert.equal(stripName('пушок', 'Пушик', PUSHIK), '');
  assert.equal(stripName('пусть звонит', 'Пушик', PUSHIK), 'пусть звонит');
  assert.equal(stripName('как отправить фото [unk]', 'Пушик', PUSHIK), 'как отправить фото');
  assert.equal(stripName('барсик открой почту', 'Барсик', ['барсик']), 'открой почту');
  assert.equal(stripName('пик', 'Барсик', ['барсик']), '', 'the tail of the name is not a request');
  assert.equal(stripName('пик открой почту', 'Барсик', ['барсик']), 'открой почту');
  assert.equal(stripName('чай', 'Барсик', ['барсик']), 'чай');
});

test('wake words: the name itself when the model knows it, else words that sound alike', () => {
  const vocab = ['барсик', 'барсуки', 'мурзик', 'мужик', 'мурзика', 'кот', 'шпили', 'шпуля'];
  assert.deepEqual(nameWords('Барсик', vocab), ['барсик']);
  assert.deepEqual(nameWords('Pushik', []), PUSHIK, 'Latin names are heard in Russian');
  assert.deepEqual(nameWords('Мурчик', vocab), ['мурзик', 'мужик', 'мурзика']);
  assert.deepEqual(nameWords('Тыгыдык', vocab), [], 'nothing alike: the cat cannot answer to it');
});

function fakeEars(fail?: Error) {
  const log = { hooks: null as EarHooks | null, started: 0, stopped: 0, name: '', words: [] as string[] };
  ears.start = async (h, name, words) => {
    log.started++;
    if (fail) throw fail;
    Object.assign(log, { hooks: h, name, words });
    return { stop: () => { log.stopped++; } };
  };
  return log;
}

const badge = () => $('#ear');
const bubbleText = () => dom.bubbleText.textContent ?? '';

function setup(over: Partial<typeof settings> = {}): void {
  resetDesk('win32');
  setSettings({ ...settings, wakeWord: false, catName: '' });
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

test('wake word is off by default and answers to a new name after renaming', async () => {
  const ear = fakeEars();
  resetDesk('win32');
  assert.equal(settings.wakeWord, false, 'the microphone is off until the person turns it on');
  setup({ wakeWord: true });
  await settle();
  assert.equal(ear.name, 'Пушик');
  assert.deepEqual(ear.words, PUSHIK);

  api.nameWords = async (name) => (name === 'Барсик' ? ['барсик'] : []);
  setSettings({ ...settings, catName: 'Барсик' });
  applySettings(); // как после «Сохранить»: тексты с новым именем и уши на новое имя
  await settle();
  assert.equal(ear.stopped, 1, 'stopped listening for the old name');
  assert.equal(ear.name, 'Барсик');
  assert.deepEqual(ear.words, ['барсик']);
  assert.match(badge().title, /Барсик/);

  setSettings({ ...settings, catName: 'Тыгыдык' });
  applySettings();
  await settle();
  assert.ok(isHidden(badge()), 'a name the model cannot hear: the microphone stays off');
  assert.match(bubbleText(), /трудно расслышать/);
});
