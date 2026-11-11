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

/** Место, которое облачку закрывать нельзя, и насколько это плохо. */
export interface Zone { rect: Rect; weight: number }

/** Зоны вокруг кнопки из подсказки: сама кнопка и место под меню у неё. */
export function targetZones(t: Rect, screenH: number): Zone[] {
  const zone = keepClear(t, screenH);
  return [{ rect: zone.target, weight: 30 }, { rect: zone.menu, weight: 3 }];
}

/** Зона вокруг того, что открылось на экране (меню, список, окно). */
export function openedZone(box: Rect): Zone {
  return { rect: { x: box.x - 10, y: box.y - 10, w: box.w + 20, h: box.h + 20 }, weight: 30 };
}

/**
 * Лучшее место для облачка размером box рядом с котом (body — где нарисован кот).
 * preferred — где облачко встало бы само; если оно ничего не закрывает, остаётся там.
 */
export function pickSpot(opts: {
  box: { w: number; h: number };
  preferred: Spot;
  body: Rect;
  zones: Zone[];
  screen: { w: number; h: number };
}): Spot {
  const { box, body, zones, screen } = opts;
  const fit = (p: Spot): Spot => ({
    x: Math.min(Math.max(8, p.x), Math.max(8, screen.w - box.w - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, screen.h - box.h - 8)),
  });
  const at = (p: Spot): Rect => ({ x: p.x, y: p.y, w: box.w, h: box.h });
  const preferred = fit(opts.preferred);
  if (!zones.some((z) => overlap(at(preferred), z.rect))) return preferred;
  const midX = body.x + body.w / 2 - box.w / 2;
  const midY = body.y + body.h / 2 - box.h / 2;
  const candidates: Spot[] = [
    { x: midX, y: body.y - box.h - 8 },                 // над котом
    { x: midX, y: body.y + body.h + 8 },                // под котом
    { x: body.x - box.w - 8, y: midY },                 // слева от кота
    { x: body.x + body.w + 8, y: midY },                // справа от кота
  ];
  // и вокруг каждого места, которое нельзя закрывать: справа, слева, снизу, сверху
  for (const { rect: r } of zones) {
    for (const y of [midY, preferred.y, r.y]) {
      candidates.push({ x: r.x + r.w + 12, y }, { x: r.x - box.w - 12, y });
    }
    for (const x of [midX, preferred.x, r.x]) {
      candidates.push({ x, y: r.y + r.h + 12 }, { x, y: r.y - box.h - 12 });
    }
  }
  const cost = (p: Spot): number => {
    const r = at(p);
    const dx = p.x + box.w / 2 - (body.x + body.w / 2);
    const dy = p.y + box.h / 2 - (body.y + body.h / 2);
    // закрывать кнопку или открывшееся окно хуже всего, кота — терпимо, далеко от кота — немного
    let v = overlap(r, body) + Math.hypot(dx, dy) * 20;
    for (const z of zones) v += overlap(r, z.rect) * z.weight;
    return v;
  };
  let best = preferred;
  let bestCost = cost(best);
  for (const c of candidates.map(fit)) {
    const v = cost(c);
    if (v < bestCost - 1) { best = c; bestCost = v; }
  }
  return best;
}
