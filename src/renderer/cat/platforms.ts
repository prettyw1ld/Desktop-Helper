// Окна других программ: их верхние края — полки, по которым гуляет кот.
import type { WinRect } from '../../shared/types';
import { settings } from '../core/settings';
import { cat, CAT_H, cx, floorY, H, size, W } from './cat';

export interface Platform { id: number; x1: number; x2: number; y: number }

let winList: WinRect[] = [];        // спереди назад
let platforms: Platform[] = [];     // видимые куски верхних краёв

// Отрезок [a, b] вырезаем из списка отрезков: там край окна закрыт другим окном.
function subtract(segs: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of segs) {
    if (b <= s || a >= e) { out.push([s, e]); continue; }
    if (a > s) out.push([s, a]);
    if (b < e) out.push([b, e]);
  }
  return out;
}

export function computePlatforms(): void {
  const out: Platform[] = [];
  const minY = CAT_H * size() + 4;
  const maxY = H() - 80;
  winList.forEach(([id, x, y, w], i) => {
    if (y < minY || y > maxY) return;
    let segs: [number, number][] = [[Math.max(0, x), Math.min(W(), x + w)]];
    for (let j = 0; j < i; j++) {
      const [, fx, fy, fw, fh] = winList[j]!;
      if (fy <= y + 2 && fy + fh > y - 4) segs = subtract(segs, fx, fx + fw);
    }
    for (const [a, b] of segs) if (b - a >= 110) out.push({ id, x1: a, x2: b, y });
  });
  platforms = out;
}

export function setWindows(list: WinRect[]): void {
  winList = settings.windows ? list : [];
  computePlatforms();
}

/** После смены настроек или размера окна. */
export function refreshPlatforms(): void {
  if (!settings.windows) winList = [];
  computePlatforms();
}

export const allPlatforms =(): readonly Platform[] => platforms;
export const platUnder = (id: number, x: number): Platform | undefined => platforms.find((p) => p.id === id && x >= p.x1 && x <= p.x2);
export const currentPlat = (): Platform | null => (cat.plat ? platUnder(cat.plat, cx()) ?? null : null);
export const groundY = (): number => { const p = currentPlat(); return p ? p.y - CAT_H : floorY(); };
