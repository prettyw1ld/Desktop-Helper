// «Объясни, что это»: вырезаем из снимка экрана область, которую обвёл человек,
// и готовим к ней контекст — снимок всего окна с красной рамкой вокруг выделения
// и сведения от системы (какая программа, какой элемент, где он находится).
// Координаты выделения — точки (DIP) окна кота, то есть всего основного экрана.
import { nativeImage, type NativeImage } from 'electron';
import type { Rect } from '../../shared/types';
import type { Shot } from './guide';

export function selectionBox(shot: Pick<Shot, 'w' | 'h' | 'display'>, selection: Rect | undefined): Electron.Rectangle {
  if (!selection || !(['x', 'y', 'w', 'h'] as const).every((k) => Number.isFinite(selection[k])) || selection.w < 8 || selection.h < 8) {
    throw new Error('Обведи элемент вместе с его названием.');
  }
  const d = shot.display;
  const wa = d.bounds; // окно кота начинается в углу экрана
  const b = d.bounds;
  const sx = shot.w / d.size.width;
  const sy = shot.h / d.size.height;
  const x = Math.max(0, Math.floor((selection.x + wa.x - b.x) * sx));
  const y = Math.max(0, Math.floor((selection.y + wa.y - b.y) * sy));
  const right = Math.min(shot.w, Math.ceil((selection.x + selection.w + wa.x - b.x) * sx));
  const bottom = Math.min(shot.h, Math.ceil((selection.y + selection.h + wa.y - b.y) * sy));
  if (right - x < 4 || bottom - y < 4) throw new Error('Выделение за пределами экрана. Выбери элемент заново.');
  return { x, y, width: right - x, height: bottom - y };
}

export function cropSelection(shot: Shot, selection: Rect | undefined): NativeImage {
  const box = selectionBox(shot, selection);
  let image = shot.image.crop(box);
  // маленькую область увеличиваем, чтобы модель разобрала подпись
  const scale = Math.min(4, Math.max(1, 600 / Math.max(box.width, box.height)));
  if (scale > 1) image = image.resize({ width: Math.round(box.width * scale), height: Math.round(box.height * scale), quality: 'best' });
  return image;
}

const VIEW_W = 1280; // ширина снимка окна для модели: подписи ещё читаются, а запрос не тяжёлый

/**
 * Снимок окна программы (или всего экрана, если окно не известно), уменьшенный до VIEW_W,
 * с красной рамкой вокруг выделения. win — окно в пикселях снимка.
 */
export function windowView(shot: Shot, selection: Rect | undefined, win: Electron.Rectangle | null): NativeImage {
  const sel = selectionBox(shot, selection);
  // окно чуть шире выделения и в пределах снимка; иначе весь экран
  let box: Electron.Rectangle = { x: 0, y: 0, width: shot.w, height: shot.h };
  if (win && win.width >= sel.width && win.height >= sel.height) {
    const x = Math.max(0, win.x);
    const y = Math.max(0, win.y);
    const r = Math.min(shot.w, win.x + win.width);
    const b = Math.min(shot.h, win.y + win.height);
    const inside = sel.x >= x - 2 && sel.y >= y - 2 && sel.x + sel.width <= r + 2 && sel.y + sel.height <= b + 2;
    if (inside && r - x > 40 && b - y > 40) box = { x, y, width: r - x, height: b - y };
  }
  let image = shot.image.crop(box);
  const k = Math.min(1, VIEW_W / box.width);
  if (k < 1) image = image.resize({ width: Math.round(box.width * k), height: Math.round(box.height * k), quality: 'good' });
  const frame = { x: (sel.x - box.x) * k, y: (sel.y - box.y) * k, width: sel.width * k, height: sel.height * k };
  return drawFrame(image, frame);
}

/** Красная рамка толщиной 4 px чуть снаружи прямоугольника (с белой окантовкой, чтобы видно на любом фоне). */
export function drawFrame(image: NativeImage, r: Electron.Rectangle): NativeImage {
  const { width: W, height: H } = image.getSize();
  const px = Buffer.from(image.toBitmap()); // BGRA
  const set = (x: number, y: number, red: boolean) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = red ? 0x2b : 0xff; px[i + 1] = red ? 0x2b : 0xff; px[i + 2] = red ? 0xe8 : 0xff; px[i + 3] = 0xff;
  };
  const x0 = Math.round(r.x) - 3, y0 = Math.round(r.y) - 3;
  const x1 = Math.round(r.x + r.width) + 2, y1 = Math.round(r.y + r.height) + 2;
  for (let t = -1; t < 5; t++) {
    const red = t >= 0 && t < 4;
    for (let x = x0 - t; x <= x1 + t; x++) { set(x, y0 - t, red); set(x, y1 + t, red); }
    for (let y = y0 - t; y <= y1 + t; y++) { set(x0 - t, y, red); set(x1 + t, y, red); }
  }
  return nativeImage.createFromBitmap(px, { width: W, height: H });
}

export { formatContext, inspectPrompt, INSPECT_SYSTEM, scrub } from './inspect-text';
