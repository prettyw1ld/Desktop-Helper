// Вызовы в главный процесс — только со страницы кота.
import './setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trustedSender } from '../src/main/ipc-guard';

test('only the cat page may call the main process', () => {
  const page = 'file:///C:/Users/denik/Desktop/%D1%85%D0%B0%D0%BA%D0%B0%D1%82%D0%BE%D0%BD/app/resources/app.asar/build/renderer/index.html';
  assert.equal(trustedSender(`${page}#chat`, page, true), true, 'hash is ignored');
  assert.equal(trustedSender('file:///c:/Users/denik/Desktop/хакатон/app/resources/app.asar/build/renderer/index.html?x=1', page, true), true, 'drive case and encoding');
  assert.equal(trustedSender('file:///C:/Users/denik/Downloads/index.html', page, true), false);
  assert.equal(trustedSender(`${page.replace('index.html', 'index.html.evil')}`, page, true), false);
  assert.equal(trustedSender('https://evil.example/index.html', page, true), false);
  assert.equal(trustedSender('about:blank', page, true), false);
  assert.equal(trustedSender(undefined, page, true), false);
  // на macOS и Linux регистр в пути важен
  assert.equal(trustedSender('file:///opt/Pushik/build/renderer/index.html', 'file:///opt/pushik/build/renderer/index.html', false), false);
});
