// Кот подходит (подпрыгивает) к кнопке и встаёт сбоку, лапкой к ней.
import type { Rect } from '../../shared/types';
import { cat, CAT_H, cx, floorY, H, jumpTo, setState, size, startFall, W, walkTo } from '../cat/cat';
import { $, dom, isHidden } from '../core/dom';
import { clamp, now, timer } from '../core/util';
import { guide } from './state';

const gaze = timer();

export function cancelPointGaze(): void {
  gaze.clear();
  cat.lookUntil = 0;
}

/** Сначала коротко глянуть в сторону кнопки, потом идти к ней. then — когда кот встал у кнопки. */
export function goPoint(t: Rect, then?: () => void): void {
  if (cat.state === 'drag') { then?.(); return; }
  cancelPointGaze();
  const dx = t.x + t.w / 2 - cx();
  const dy = t.y + t.h / 2 - (cat.y + CAT_H / 2);
  cat.dir = dx >= 0 ? 1 : -1;
  cat.lookPose = Math.abs(dx) < 70 ? (dy < 0 ? 'standB' : 'standF') : (dx < 0 ? 'standL' : 'standR');
  cat.lookUntil = now() + 320;
  setState('busy');
  gaze.set(() => {
    if (cat.state !== 'busy' || !cat.lookUntil) return;
    cat.lookUntil = 0;
    moveToPoint(t, then);
  }, 320);
}

function moveToPoint(t: Rect, then?: () => void): void {
  const k = size();
  const half = 52 * k;                       // половина видимой ширины кота
  const right = t.x + t.w / 2 > W() / 2;     // кнопка справа: кот встаёт слева от неё
  let center = right ? t.x - half - 6 : t.x + t.w + half + 6;
  // не влезает сбоку: встаём под кнопкой
  if (center < half || center > W() - half) center = clamp(t.x + t.w / 2, half, W() - half);
  const facing = center < t.x + t.w / 2 ? 1 : -1;
  const feet = clamp(t.y + t.h / 2 + 45 * k, 115 * k, H());
  let y = feet - CAT_H;
  const done = () => {
    // подсказку уже отменили, пока кот прыгал: не остаёмся висеть наверху
    if (!guide.active) { startFall(); return; }
    cat.dir = facing;
    setState('perch');
    then?.();
  };
  if (y > floorY() - 40) {
    // кнопка внизу экрана: просто идём по полу
    y = floorY();
    if (cat.state === 'perch' || cat.plat) { jumpTo(center, y, null, done); return; }
    if (Math.abs(center - cx()) < 8) { done(); return; }
    walkTo(center, Math.abs(center - cx()) > 400, done);
    return;
  }
  jumpTo(center, y, null, done);
}

/** Где на экране нарисован сам кот: эти места не считаются, когда следим за изменениями экрана. */
export function guideMasks(): Rect[] {
  return [$('#sprite'), dom.bubble, dom.ring, dom.badge]
    .filter((e) => !isHidden(e))
    .map((e) => e.getBoundingClientRect())
    .map((r) => ({ x: Math.round(r.left - 12), y: Math.round(r.top - 12), w: Math.round(r.width + 24), h: Math.round(r.height + 24) }));
}

/**
 * Кот стоит поверх того, что открылось (меню, окно): отпрыгивает вбок, чтобы не закрывать.
 * box — в координатах окна кота. Большое окно (почти весь экран) не обойти: остаётся на месте.
 */
export function stepAside(box: Rect): void {
  if (['drag', 'jump', 'fall'].includes(cat.state)) return;
  if (box.w * box.h > W() * H() * 0.55) return;
  const s = $('#sprite').getBoundingClientRect();
  const hit = s.left < box.x + box.w && s.right > box.x && s.top < box.y + box.h && s.bottom > box.y;
  if (!hit || !s.width) return;
  const half = 52 * size();
  const now = cx();
  const spots = [box.x + box.w + half + 10, box.x - half - 10].filter((x) => x >= half && x <= W() - half);
  if (!spots.length) return;
  const center = spots.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0]!;
  const facing = center < box.x + box.w / 2 ? 1 : -1;
  jumpTo(center, cat.y, null, () => {
    if (!guide.active) { startFall(); return; }
    cat.dir = facing;
    setState('perch');
  });
}
