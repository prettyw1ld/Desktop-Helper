// Кот иногда следит за курсором: поворачивает голову, а если курсор шевелится рядом, бьёт по нему лапкой.
import { api } from '../core/api';
import { T } from '../core/i18n';
import { now, rand } from '../core/util';
import { busyWithPerson } from '../guide/state';
import { say } from '../ui/bubble';
import { openPanel } from '../ui/panels';
import { cat, CAT_H, cx, setState } from './cat';
import { dirAnim, type AnimName } from './sprites';

// dist: сколько курсор прошёл за последнюю секунду
const mouse = { x: -1, y: -1, t: 0, dist: 0 };
let nextCheck = 0;

export const mouseMoving = (ms = 1200): boolean => now() - mouse.t < ms;

export function trackMouse(x: number, y: number): void {
  const t = now();
  const moved = mouse.x < 0 ? 0 : Math.hypot(x - mouse.x, y - mouse.y);
  if (mouse.x >= 0 && moved < 1) return; // курсор стоит на месте
  mouse.dist = (t - mouse.t < 1000 ? mouse.dist : 0) + moved;
  mouse.x = x;
  mouse.y = y;
  mouse.t = t;
}

export function startCursorWatch(ms = rand(6000, 12_000)): void {
  setState('idle', ms);
  cat.watchUntil = now() + ms;
  cat.watchSide = 0;
  const s = T('act.watch');
  if (s && Math.random() < 0.4) say(s, 2200);
}

export const watchingCursor = (t: number): boolean => !!cat.watchUntil && t < cat.watchUntil;

/** Поза, пока кот смотрит на курсор. */
export function watchPose(t: number): AnimName {
  const dx = mouse.x - cx();
  const dy = mouse.y - (cat.y + CAT_H * 0.45);
  if (t < cat.swipeUntil) return cat.swipePose;
  if (Math.hypot(dx, dy) < 90 && mouseMoving(300) && t > cat.swipeCool) {
    cat.swipePose = dirAnim('swipeSit', dx < 0 ? -1 : 1);
    cat.swipeUntil = t + 900;
    cat.swipeCool = t + 2500;
    return cat.swipePose;
  }
  // поворот с запасом, чтобы голова не дёргалась, когда курсор на границе
  if (Math.abs(dx) > 90) cat.watchSide = dx < 0 ? -1 : 1;
  else if (Math.abs(dx) < 45) cat.watchSide = 0;
  if (cat.watchSide) cat.dir = cat.watchSide;
  return cat.watchSide ? dirAnim('sit', cat.watchSide) : 'blinkSitF';
}

/** Каждый кадр: не пора ли заметить курсор, и не пора ли перестать за ним следить. */
export function updateCursorWatch(t: number): void {
  // заметить курсор: когда сидит без дела, занят собой или гуляет, а мышь шевелится рядом
  const calm = cat.state === 'idle' || cat.state === 'act'
    || (cat.state === 'walk' && !cat.running && !cat.onArrive && !cat.climb && Math.abs(mouse.x - cx()) < 300);
  if (calm && !cat.watchUntil && t > nextCheck) {
    nextCheck = t + 1000;
    if (mouse.dist > 150 && mouseMoving(400) && !busyWithPerson() && !openPanel() && Math.random() < 0.3) startCursorWatch();
  }
  if (cat.watchUntil && !mouseMoving(4000)) cat.watchUntil = 0;
}

// Окно пропускает клики насквозь, и тогда Windows присылает движения мыши не всегда.
// Поэтому 10 раз в секунду спрашиваем курсор у главного процесса: так кот видит мышь и над другими окнами.
export function initCursorWatch(): void {
  document.addEventListener('mousemove', (e) => trackMouse(e.clientX, e.clientY));
  setInterval(async () => {
    const p = await api.getCursor();
    if (p) trackMouse(p.x, p.y);
  }, 100);
}
