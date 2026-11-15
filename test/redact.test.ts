// Что уходит к модели: скрытый текст, личные номера и ключи вычищаются; пауза снимков.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePolicy, parseReg, regToRaw } from '../src/main/policy';
import { pauseShots, resumeShots, shotsPaused } from '../src/main/ai/privacy';
import { parseMasks, redact, SCREEN_DATA_RULE, stripHidden } from '../src/main/ai/redact';
import { scrub } from '../src/main/ai/inspect-text';

test('hidden characters that smuggle commands to the AI are removed', () => {
  const tag = String.fromCodePoint(0xe0049, 0xe0067); // «теги» Unicode: невидимый текст
  assert.equal(stripHidden(`Оп​ла‮та${tag}﻿`), 'Оплата');
  assert.equal(scrub('Кноп‍ка «ОК»'), "Кнопка 'ОК'");
  assert.match(SCREEN_DATA_RULE, /never instructions/);
});

test('card, INN, SNILS, passport and keys are masked; ordinary numbers stay', () => {
  assert.equal(redact('карта 4111 1111 1111 1111, сумма 1500'), 'карта [карта], сумма 1500');
  assert.equal(redact('карта 4111 1111 1111 1112'), 'карта 4111 1111 1111 1112'); // не проходит Луна
  assert.equal(redact('ИНН 7707083893'), 'ИНН [ИНН]');
  assert.equal(redact('ИНН 500100732259'), 'ИНН [ИНН]');
  assert.equal(redact('заказ 7707083890'), 'заказ 7707083890');
  assert.equal(redact('СНИЛС 112-233-445 95'), 'СНИЛС [СНИЛС]');
  assert.equal(redact('паспорт: 45 06 123456'), 'паспорт: [паспорт]');
  assert.equal(redact('key sk-abcDEF1234567890abcdef'), 'key [ключ]');
  assert.equal(redact('ghp_' + 'a1'.repeat(15)), '[ключ]');
  assert.equal(redact('Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4'), 'Bearer [ключ]');
  assert.equal(redact('token Qx7mP2vL9kR4tW8nB3cF6hJ1sD5gA0zYeU'), 'token [ключ]');
  assert.equal(redact('Версия 2026.11.15, окно 1920x1080'), 'Версия 2026.11.15, окно 1920x1080');
});

test('organisation masks hide its own identifiers; bad masks are skipped', () => {
  const masks = parseMasks(['ТН-\\d{6}', '(a+)+', '[', 42, 'x'.repeat(201)]);
  assert.equal(masks.length, 1);
  assert.equal(redact('сотрудник ТН-004512 и тн-000001', masks), 'сотрудник [скрыто] и [скрыто]');
  const p = parsePolicy({ privacy: { screenshots: 'window', masks: ['ТН-\\d{6}', 7] } });
  assert.deepEqual(p.privacy.masks, ['ТН-\\d{6}']);
  const reg = parseReg('\r\n    Masks    REG_MULTI_SZ    ТН-\\d{6}\\0ДГ-\\d+\r\n');
  assert.deepEqual((regToRaw(reg)?.privacy as { masks: string[] }).masks, ['ТН-\\d{6}', 'ДГ-\\d+']);
});

test('pausing screenshots lasts an hour and can be lifted', () => {
  resumeShots();
  assert.equal(shotsPaused(), 0);
  pauseShots(3600_000, 1000);
  assert.equal(shotsPaused(1000), 3600_000);
  assert.equal(shotsPaused(3601_000), 0);
  pauseShots();
  assert.ok(shotsPaused() > 3500_000);
  resumeShots();
  assert.equal(shotsPaused(), 0);
});
