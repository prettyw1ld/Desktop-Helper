// Кот иногда следит за курсором: сидит лицом к нам (или спиной, глядя в экран) и по пикселю
// поворачивает голову туда, где мышка. Курсор шевелится у самой морды: бьёт по нему лапкой.
import { api } from '../core/api';
import { T } from '../core/i18n';
import { now, pick } from '../core/util';
import { busyWithPerson } from '../guide/state';
import { say } from '../ui/bubble';
import { openPanel } from '../ui/panels';
import { cat, CAT_H, cx, setState, size } from './cat';
import { between, LIFE } from './pacing';
import { dirAnim, type AnimName, type HeadTurn } from './sprites';

// dist: сколько курсор прошёл за последнюю секунду
const mouse = { x: -1, y: -1, t: -Infinity, dist: 0 };
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

// Голова кота примерно на 120 px выше лап.
const headY = (): number => cat.y + CAT_H - 120 * size();

export type WatchMode = 'front' | 'back';

/** Начать следить за курсором. Без mode: лицом к нам, а если курсор высоко над котом, иногда спиной. */
export function startCursorWatch(ms = between(LIFE.watch), mode?: WatchMode): void {
  const over = mouse.x >= 0 && mouse.y - headY() < -150;
  setState('idle', ms);
  cat.watchUntil = now() + ms;
  cat.swipeUntil = 0;
  cat.watchBack = (mode ?? (over && Math.random() < 0.4 ? 'back' : 'front')) === 'back';
  const poses: AnimName[] = cat.watchBack ? ['wagSitB', 'wagSitB', 'wagStandB'] : ['wagBlinkSitF', 'blinkSitF'];
  cat.head = { pose: pick(poses), hx: 0, hy: 0, turnedAt: 0 };
  const s = T('act.watch');
  if (s && Math.random() < 0.4) say(s, 2200);
}

export const watchingCursor = (t: number): boolean => !!cat.watchUntil && t < cat.watchUntil;

// Куда повернуть голову: на сколько пикселей листа (±3 вбок, ±1 вверх/вниз).
function gazeTarget(): [number, number] {
  if (mouse.x < 0) return [0, 0];
  const dx = mouse.x - cx();
  const dy = mouse.y - headY();
  return [Math.round(3 * Math.tanh(dx / 260)), dy < -90 ? -1 : dy > 160 ? 1 : 0];
}

/** Поза, пока кот смотрит на курсор. */
export function watchPose(t: number): AnimName | HeadTurn {
  const dx = mouse.x - cx();
  const dy = mouse.y - (cat.y + CAT_H * 0.45);
  if (t < cat.swipeUntil) return cat.swipePose;
  if (Math.hypot(dx, dy) < 90 && mouseMoving(300) && t > cat.swipeCool) {
    cat.swipePose = dirAnim('swipeSit', dx < 0 ? -1 : 1);
    cat.swipeUntil = t + 900;
    cat.swipeCool = t + 2500;
    return cat.swipePose;
  }
  return { watch: cat.head.pose, hx: cat.head.hx, hy: cat.head.hy };
}

/** Каждый кадр: не пора ли заметить курсор, повернуть голову или перестать следить. */
export function updateCursorWatch(t: number): void {
  // заметить курсор: когда сидит без дела, занят собой или гуляет, а мышь шевелится рядом
  const calm = cat.state === 'idle' || cat.state === 'act'
    || (cat.state === 'walk' && !cat.running && !cat.onArrive && !cat.climb && Math.abs(mouse.x - cx()) < 300);
  if (calm && !cat.watchUntil && t > nextCheck) {
    nextCheck = t + 1000;
    if (mouse.dist > 150 && mouseMoving(400) && !busyWithPerson() && !openPanel() && Math.random() < 0.3) startCursorWatch();
  }
  if (!cat.watchUntil) return;
  // голова поворачивается по пикселю за раз, а не прыгает
  const h = cat.head;
  if (t - h.turnedAt > 80) {
    const [tx, ty] = gazeTarget();
    if (tx !== h.hx || ty !== h.hy) {
      h.hx += Math.sign(tx - h.hx);
      h.hy += Math.sign(ty - h.hy);
      h.turnedAt = t;
    }
  }
  // мышка давно стоит: коту надоело
  if (t - cat.since > 4000 && !mouseMoving(LIFE.watchBored)) cat.watchUntil = 0;
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
