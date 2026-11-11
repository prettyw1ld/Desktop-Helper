// Цвет окошек и окрас кота показываются сразу при выборе, а без «Сохранить» возвращаются.
import './setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTheme } from '../src/renderer/panels/settings';

test('window colour is applied through html[data-theme], cream is the default', () => {
  setTheme('sky');
  assert.equal(document.documentElement.dataset.theme, 'sky');
  setTheme('cream');
  assert.equal(document.documentElement.dataset.theme, undefined);
  setTheme('neon');
  assert.equal(document.documentElement.dataset.theme, undefined, 'unknown colour falls back to cream');
});
