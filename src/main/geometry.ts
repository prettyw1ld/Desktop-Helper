// Перевод прямоугольников с экрана в окно кота. Без electron, чтобы проверять тестами.
import type { Rect } from '../shared/types';

export type Box = { x: number; y: number; width: number; height: number };

/** Прямоугольник в координатах экрана (DIP) → координаты окна кота. */
export function fitToWorkArea(r: Rect, wa: Box, bounds: Box, keep = false): Rect | null {
  const o = { x: Math.round(r.x - wa.x), y: Math.round(r.y - wa.y), w: Math.round(r.w), h: Math.round(r.h) };
  if (keep) return o;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  if (cx >= 0 && cy >= 0 && cx <= wa.width && cy <= wa.height) return o;
  // середина за краем рабочей области, но на этом же мониторе: это панель задач
  const sx = cx + wa.x;
  const sy = cy + wa.y;
  const onDisplay = sx >= bounds.x && sy >= bounds.y && sx <= bounds.x + bounds.width && sy <= bounds.y + bounds.height;
  if (!onDisplay) return null;
  const EDGE = 28;
  const w = Math.min(o.w, wa.width);
  const h = Math.min(o.h, wa.height);
  let x = Math.max(0, Math.min(o.x, wa.width - w));
  let y = Math.max(0, Math.min(o.y, wa.height - h));
  let ww = w;
  let hh = h;
  if (cy > wa.height) { hh = Math.min(h, EDGE); y = wa.height - hh; }
  else if (cy < 0) { hh = Math.min(h, EDGE); y = 0; }
  if (cx > wa.width) { ww = Math.min(w, EDGE); x = wa.width - ww; }
  else if (cx < 0) { ww = Math.min(w, EDGE); x = 0; }
  return { x, y, w: ww, h: hh };
}
