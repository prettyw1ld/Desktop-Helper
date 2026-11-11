// Куда поставить облачко подсказки, чтобы оно не закрывало кнопку, на которую показывает кот,
// и место рядом с ней, где обычно открывается меню или список (под кнопкой, а внизу экрана — над ней).
import type { Rect } from '../../shared/types';

export interface Spot { x: number; y: number }

const MENU_W = 320; // примерно меню «Файл», «Вид», «Пуск»
const MENU_H = 380;

/** Что облачку закрывать нельзя: сама кнопка и место под меню у неё. */
export function keepClear(t: Rect, screenH: number): { target: Rect; menu: Rect } {
  const pad = 14;
  const target = { x: t.x - pad, y: t.y - pad, w: t.w + pad * 2, h: t.h + pad * 2 };
  const w = Math.max(t.w, MENU_W) + 20;
  const down = t.y + t.h / 2 < screenH * 0.6;
  const menu = down
    ? { x: t.x - 10, y: t.y + t.h, w, h: MENU_H }
    : { x: t.x - 10, y: t.y - MENU_H, w, h: MENU_H };
  return { target, menu };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Лучшее место для облачка размером box рядом с котом (body — где нарисован кот).
 * preferred — где облачко встало бы само; если оно ничего не закрывает, остаётся там.
 */
export function pickSpot(opts: {
  box: { w: number; h: number };
  preferred: Spot;
  body: Rect;
  target: Rect;
  screen: { w: number; h: number };
}): Spot {
  const { box, body, target, screen } = opts;
  const fit = (p: Spot): Spot => ({
    x: Math.min(Math.max(8, p.x), Math.max(8, screen.w - box.w - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, screen.h - box.h - 8)),
  });
  const zone = keepClear(target, screen.h);
  const at = (p: Spot): Rect => ({ x: p.x, y: p.y, w: box.w, h: box.h });
  const preferred = fit(opts.preferred);
  if (!overlap(at(preferred), zone.target) && !overlap(at(preferred), zone.menu)) return preferred;
  const midX = body.x + body.w / 2 - box.w / 2;
  const midY = body.y + body.h / 2 - box.h / 2;
  const candidates: Spot[] = [
    opts.preferred,
    { x: midX, y: body.y - box.h - 8 },                 // над котом
    { x: midX, y: body.y + body.h + 8 },                // под котом
    { x: body.x - box.w - 8, y: midY },                 // слева от кота
    { x: body.x + body.w + 8, y: midY },                // справа от кота
    { x: zone.menu.x + zone.menu.w + 12, y: midY },     // правее меню
    { x: zone.menu.x - box.w - 12, y: midY },           // левее меню
    { x: zone.menu.x + zone.menu.w + 12, y: opts.preferred.y },
    { x: zone.menu.x - box.w - 12, y: opts.preferred.y },
  ].map(fit);
  candidates[0] = preferred;
  const cost = (p: Spot): number => {
    const r = at(p);
    const dx = p.x + box.w / 2 - (body.x + body.w / 2);
    const dy = p.y + box.h / 2 - (body.y + body.h / 2);
    // кнопку закрывать хуже всего, место под меню — плохо, кота — терпимо, далеко от кота — немного
    return overlap(r, zone.target) * 30 + overlap(r, zone.menu) * 3 + overlap(r, body) + Math.hypot(dx, dy) * 20;
  };
  let best = candidates[0]!;
  let bestCost = cost(best);
  for (const c of candidates.slice(1)) {
    const v = cost(c);
    if (v < bestCost - 1) { best = c; bestCost = v; }
  }
  return best;
}
