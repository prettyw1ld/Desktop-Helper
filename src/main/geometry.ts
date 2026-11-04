// Перевод прямоугольников с экрана в окно кота. Без electron, чтобы проверять тестами.
import type { Rect } from '../shared/types';

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Прямоугольник в координатах экрана (DIP) → координаты окна кота.
 * Окно кота закрывает весь основной экран, вместе с панелью задач, поэтому рамка ложится прямо на кнопку.
 * Кнопка на другом мониторе: null (keep — вернуть как есть).
 */
export function toFrame(r: Rect, frame: Box, keep = false): Rect | null {
  const o = { x: Math.round(r.x - frame.x), y: Math.round(r.y - frame.y), w: Math.round(r.w), h: Math.round(r.h) };
  if (keep) return o;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  return cx >= 0 && cy >= 0 && cx <= frame.width && cy <= frame.height ? o : null;
}

/** Рабочая область (без панели задач) в координатах окна кота: здесь пол и стены для кота. */
export function workInFrame(work: Box, frame: Box): Rect {
  return { x: work.x - frame.x, y: work.y - frame.y, w: work.width, h: work.height };
}

/**
 * Окно кота: весь экран без одной нижней строки пикселей. Окно ровно во весь экран Windows
 * считает полноэкранной программой (прячет уведомления, ведёт себя как игра).
 */
export function overlayBounds(bounds: Box): Box {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height - 1 };
}
