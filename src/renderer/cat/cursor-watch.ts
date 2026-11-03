// Кот иногда следит за курсором: сидит лицом к нам и плавно поворачивает голову туда, где мышка,
// по одному нарисованному положению за раз. Курсор шевелится у самой морды: бьёт по нему лапкой.
import { api } from '../core/api';
import { T } from '../core/i18n';
import { now, rand } from '../core/util';
import { busyWithPerson } from '../guide/state';
import { say } from '../ui/bubble';
import { openPanel } from '../ui/panels';
import { cat, CAT_H, cx, setState, size } from './cat';
import { between, LIFE } from './pacing';
import { dirAnim, GAZE_MAX, type AnimName, type HeadTurn } from './sprites';

// Голова поворачивается на одно положение за TURN_STEP мс: от середины до края за ~0,2 с.
const TURN_STEP = 70;
// Курсор должен уйти дальше этой доли положения, чтобы голова повернулась: без дёрганья на границе.
const TURN_SLACK = 0.7;
const BLINK_MS = 150;

// seen: курсор уже видели (координаты бывают и отрицательными: монитор слева от основного);
// dist: сколько курсор прошёл за последнюю секунду
const mouse = { x: 0, y: 0, seen: false, t: -Infinity, dist: 0 };
let nextCheck = 0;

export const mouseMoving = (ms = 1200): boolean => now() - mouse.t < ms;

export function trackMouse(x: number, y: number): void {
  const t = now();
  const moved = mouse.seen ? Math.hypot(x - mouse.x, y - mouse.y) : 0;
  if (mouse.seen && moved < 1) return; // курсор стоит на месте
  mouse.seen = true;
  mouse.dist = (t - mouse.t < 1000 ? mouse.dist : 0) + moved;
  mouse.x = x;
  mouse.y = y;
  mouse.t = t;
}

// Голова кота примерно на 120 px выше лап.
const headY = (): number => cat.y + CAT_H - 120 * size();

export function startCursorWatch(ms = between(LIFE.watch)): void {
  setState('idle', ms);
  cat.watchUntil = now() + ms;
  cat.swipeUntil = 0;
  cat.head = { gaze: 0, target: 0, up: false, turnedAt: 0, blinkAt: now() + rand(1500, 4000) };
  const s = T('act.watch');
  if (s && Math.random() < 0.4) say(s, 2200);
}

export const watchingCursor = (t: number): boolean => !!cat.watchUntil && t < cat.watchUntil;

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
  const h = cat.head;
  return { gaze: h.gaze, up: h.up, blink: t >= h.blinkAt && t < h.blinkAt + BLINK_MS };
}

// Куда вести голову: положение -3..3 по горизонтали (с запасом) и смотреть ли вверх.
function aim(): void {
  const h = cat.head;
  if (!mouse.seen) return;
  const want = GAZE_MAX * Math.tanh((mouse.x - cx()) / 300);
  if (Math.abs(want - h.target) > TURN_SLACK) h.target = Math.round(want);
  const dy = mouse.y - headY();
  h.up = h.up ? dy < -60 : dy < -120;
}

/** Каждый кадр: не пора ли заметить курсор, повернуть голову, моргнуть или перестать следить. */
export function updateCursorWatch(t: number): void {
  // заметить курсор: когда сидит без дела, занят собой или гуляет, а мышь шевелится рядом
  const calm = cat.state === 'idle' || cat.state === 'act'
    || (cat.state === 'walk' && !cat.running && !cat.onArrive && !cat.climb && Math.abs(mouse.x - cx()) < 300);
  if (calm && !cat.watchUntil && t > nextCheck) {
    nextCheck = t + 1000;
    if (mouse.dist > 150 && mouseMoving(400) && !busyWithPerson() && !openPanel() && Math.random() < 0.3) startCursorWatch();
  }
  if (!cat.watchUntil) return;
  const h = cat.head;
  aim();
  // голова идёт к цели по одному положению, а не прыгает
  if (h.gaze !== h.target && t - h.turnedAt >= TURN_STEP) {
    h.gaze += Math.sign(h.target - h.gaze);
    h.turnedAt = t;
  }
  if (t > h.blinkAt + BLINK_MS) h.blinkAt = t + rand(2500, 6000);
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
