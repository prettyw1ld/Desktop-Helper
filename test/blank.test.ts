// «Объясни это» по пустому месту: такую область не отправляем ИИ.
import './setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeShare, isBlank } from '../src/main/ai/blank';
import type { InspectContext } from '../src/shared/types';

function bitmap(w: number, h: number, paint: (x: number, y: number) => number): Buffer {
  const b = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = paint(x, y);
    b.set([v, v, v, 255], (y * w + x) * 4);
  }
  return b;
}

const ctx = (name: string, nearby: string[] = []): InspectContext => ({
  app: 'Блокнот', proc: 'notepad', title: 'Без имени', element: name ? { name, type: 'Button' } : null,
  path: [], nearby: nearby.map((n) => ({ name: n, type: 'Text' })),
});

test('a plain area counts as blank, a line of text does not', () => {
  const plain = edgeShare(bitmap(300, 120, () => 240), 300, 120);
  assert.equal(plain, 0);
  assert.ok(isBlank(plain, ctx('Сохранить')), 'one colour is blank even if the system names the window under it');
  // «буквы»: тёмные штрихи через каждые 6 точек в средней полосе
  const text = edgeShare(bitmap(300, 120, (x, y) => (y > 50 && y < 70 && x % 6 < 2 ? 20 : 240)), 300, 120);
  assert.ok(text > 0.01, `text has edges (${text})`);
  assert.equal(isBlank(text, null), false);
});

test('a soft gradient is blank only when the system finds nothing there', () => {
  // плавный фон с редкой рамкой: краёв мало
  const soft = edgeShare(bitmap(400, 200, (x, y) => (x === 200 ? 0 : 100 + Math.floor(x / 10))), 400, 200);
  assert.ok(soft >= 0.003 && soft < 0.01, `few edges (${soft})`);
  assert.equal(isBlank(soft, null), true);
  assert.equal(isBlank(soft, ctx('')), true, 'an element without a name does not count');
  assert.equal(isBlank(soft, ctx('Сохранить')), false);
  assert.equal(isBlank(soft, ctx('', ['Файл'])), false);
});

test('a broken bitmap is never called blank', () => {
  assert.equal(edgeShare(Buffer.alloc(8), 300, 120), 1);
  assert.equal(edgeShare(Buffer.alloc(0), 1, 1), 1);
});
