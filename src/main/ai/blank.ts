// «Объясни это» по пустому месту: однотонная область без кнопок и текста не уходит к ИИ.
import type { InspectContext } from '../../shared/types';

const STEP_LUMA = 20;      // разница яркости соседних точек, с которой считаем, что там край (буква, рамка)
const BLANK_EDGES = 0.003; // меньше стольких краёв — область однотонная, что бы ни сказала система
const QUIET_EDGES = 0.01;  // почти без краёв и система тоже ничего там не нашла

/** Доля точек с заметным краем. bitmap — BGRA, как у NativeImage.toBitmap(). */
export function edgeShare(bitmap: Buffer, w: number, h: number): number {
  if (w < 2 || h < 2 || bitmap.length < w * h * 4) return 1;
  // большие области смотрим через точку: так быстро, а буквы всё равно видны
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250_000)));
  const luma = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.114 * bitmap[i]! + 0.587 * bitmap[i + 1]! + 0.299 * bitmap[i + 2]!;
  };
  let edges = 0;
  let seen = 0;
  for (let y = 0; y + step < h; y += step) {
    for (let x = 0; x + step < w; x += step) {
      const l = luma(x, y);
      if (Math.abs(l - luma(x + step, y)) > STEP_LUMA || Math.abs(l - luma(x, y + step)) > STEP_LUMA) edges++;
      seen++;
    }
  }
  return seen ? edges / seen : 1;
}

/** Система (UI Automation) нашла под выделением что-то с названием. */
export function hasElements(ctx: InspectContext | null): boolean {
  if (!ctx) return false;
  return !!ctx.element?.name?.trim() || ctx.nearby.some((n) => !!n.name?.trim());
}

/** Пустое место: однотонно, или почти однотонно и без элементов. */
export function isBlank(edges: number, ctx: InspectContext | null): boolean {
  if (edges < BLANK_EDGES) return true;
  return edges < QUIET_EDGES && !hasElements(ctx);
}
