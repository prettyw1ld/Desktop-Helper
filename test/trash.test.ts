// Корзина: кота относят в Корзину, он пропадает, из трея он вылезает обратно.
import './setup';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { initTrayCommands } from '../src/renderer/app/tray-commands';
import { cat } from '../src/renderer/cat/cat';
import { isTrashed, leaveTrash } from '../src/renderer/cat/trash';
import { api } from '../src/renderer/core/api';
import { dom } from '../src/renderer/core/dom';
import { initMouse } from '../src/renderer/input/mouse';
import { resetDesk, settle } from './helpers';

initMouse();
initTrayCommands();

// Корзина на рабочем столе Windows, в левом верхнем углу
const BIN = { x: 20, y: 20, w: 76, h: 70, name: 'Корзина', type: 'ListItem', focused: false, enabled: true, proc: 'explorer' };

beforeEach(() => {
  resetDesk('win32');
  api.locate = async (q) => (q.scope === 'desktop' ? { items: [BIN] } : { items: [] });
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});
afterEach(() => {
  leaveTrash();
  mock.timers.reset();
});

const mouse = (target: EventTarget, type: string, x = 0, y = 0) =>
  target.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true }));

async function carryTo(x: number, y: number): Promise<void> {
  mouse(dom.cat, 'mousedown', 230, 430);
  mouse(document, 'mousemove', x, y);
  await settle(); // корзину ищут, пока кота несут
  mouse(document, 'mouseup', x, y);
}

test('cat dropped on the Recycle Bin disappears and climbs out from the tray icon', async () => {
  await carryTo(60, 20);
  assert.equal(cat.state, 'trash');
  assert.ok(isTrashed());
  mock.timers.tick(500);
  assert.ok(dom.cat.classList.contains('trashed'));

  // нажали на значок в трее: окно было спрятано, приходит «show»
  window.__emit?.('open', 'show');
  await settle();
  mock.timers.tick(1000);
  assert.ok(!dom.cat.classList.contains('trashed'), 'cat jumps out of the bin');
  mock.timers.tick(1500);
  assert.equal(isTrashed(), false);
  assert.equal(cat.state, 'idle');
});

test('cat dropped away from the Recycle Bin just falls', async () => {
  await carryTo(700, 300);
  assert.equal(cat.state, 'fall');
  assert.equal(isTrashed(), false);
});

test('no Recycle Bin found: the cat falls as usual', async () => {
  api.locate = async () => ({ items: [] });
  await carryTo(60, 20);
  assert.equal(cat.state, 'fall');
});

test('reminder or menu pulls the cat out of the bin at once', async () => {
  await carryTo(60, 20);
  assert.ok(isTrashed());
  leaveTrash();
  assert.equal(isTrashed(), false);
  assert.ok(!dom.cat.classList.contains('trashed'));
  assert.equal(cat.state, 'idle');
});
