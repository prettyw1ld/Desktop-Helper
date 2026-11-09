// Кот иногда следит за курсором: сидит лицом к нам и плавно поворачивает голову туда, где мышка,
// по одному нарисованному положению за раз. Курсор шевелится у самой морды: бьёт по нему лапкой
// (сбоку, спереди или встаёт на задние лапы, если мышка над головой), до трёх раз подряд.
// Курсор бегает у пола неподалёку: кот прижимается, виляет попой и прыгает на него.
import { api } from '../core/api';
import { T } from '../core/i18n';
import { Sound } from '../core/sound';
import { clamp, now, pick, rand } from '../core/util';
import { busyWithPerson } from '../guide/state';
import { strokes } from '../input/stroke';
import { say } from '../ui/bubble';
import { openPanel } from '../ui/panels';
import { cat, CAT_H, CAT_W, cx, floorY, jumpTo, setState, size, W } from './cat';
import { happy, showPose } from './poses';
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
let nextHunt = 0;

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
  cat.huntUntil = 0;
  cat.head = { gaze: 0, target: 0, up: false, turnedAt: 0, blinkAt: now() + rand(1500, 4000) };
  const s = T('act.watch');
  if (s && Math.random() < 0.4) say(s, 2200);
}

export const watchingCursor = (t: number): boolean => !!cat.watchUntil && t < cat.watchUntil;

// Охота: курсор у пола не ближе REACH и не дальше NEAR — крадётся; ушёл дальше FAR — бросает.
const HUNT = { reach: 95, near: 380, far: 520 };

// Удар лапой туда, где курсор: мышка над головой — встаёт на задние лапы и тянется,
// прямо перед мордой — бьёт передними, сбоку — боковой удар. Варианты кадров чередуются.
function swipe(t: number, dx: number): void {
  const side = dx < 0 ? -1 : 1;
  const second = cat.swipes % 2 === 1;
  if (mouse.y < headY() - 30) cat.swipePose = 'hind';
  else if (Math.abs(dx) < 25) cat.swipePose = second ? 'swipeSitF2' : 'swipeSitF';
  else cat.swipePose = second ? `${dirAnim('swipeSit', side)}2` : dirAnim('swipeSit', side);
  cat.swipeUntil = t + (cat.swipePose === 'hind' ? 1000 : 900);
  // несколько ударов подряд, пока мышка дразнит, потом передышка
  cat.swipes = t - cat.swipeCool < 1200 ? cat.swipes + 1 : 1;
  cat.swipeCool = t + (cat.swipes >= 3 ? 2500 : 950);
  if (cat.swipes >= 3) cat.swipes = 0;
}

/** Поза, пока кот смотрит на курсор. */
export function watchPose(t: number): AnimName | HeadTurn {
  const dx = mouse.x - cx();
  const dy = mouse.y - (cat.y + CAT_H * 0.45);
  if (t < cat.swipeUntil) return cat.swipePose;
  if (cat.huntUntil) return dirAnim('hunt', cat.dir);
  // курсор у морды бьём лапкой, но не когда кота гладят
  // над головой кот дотягивается выше, встав на задние лапы
  const overHead = Math.abs(dx) < 60 && mouse.y < headY() - 30 && mouse.y > headY() - 110;
  if ((Math.hypot(dx, dy) < HUNT.reach || overHead) && mouseMoving(300) && t > cat.swipeCool && !strokes.active(t)) {
    swipe(t, dx);
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
    if (mouse.dist > 150 && mouseMoving(400) && !busyWithPerson() && !openPanel() && !strokes.active(t) && Math.random() < 0.3) startCursorWatch();
  }
  if (!cat.watchUntil) return;
  if (updateHunt(t)) return;
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

// Курсор у пола: выше головы кота мышку не ловят, а с окна кот не прыгает.
const low = (): boolean => mouse.y > headY() - 40;

// Охотится: true, пока крадётся (голову к курсору не поворачивает).
function updateHunt(t: number): boolean {
  const dx = mouse.x - cx();
  const dist = Math.abs(dx);
  const distracted = busyWithPerson() || !!openPanel() || strokes.active(t) || cat.state !== 'idle';
  if (!cat.huntUntil) {
    if (distracted || cat.plat || t < cat.huntCool || t < cat.swipeUntil || t < nextHunt) return false;
    nextHunt = t + 600;
    if (low() && dist > HUNT.reach + 30 && dist < HUNT.near && mouseMoving(800) && Math.random() < 0.35) {
      cat.huntUntil = t + rand(1200, 2600);
      cat.watchUntil = Math.max(cat.watchUntil, cat.huntUntil + 500);
      cat.until = Math.max(cat.until, cat.watchUntil);
      cat.dir = dx < 0 ? -1 : 1;
      return true;
    }
    return false;
  }
  // мышка ушла далеко или наверх, кота отвлекли: охота кончилась; подбежала к морде: бьёт лапой
  if (distracted || dist > HUNT.far || !low() || dist < HUNT.reach) {
    cat.huntUntil = 0;
    cat.huntCool = t + 5000;
    return false;
  }
  cat.dir = dx < 0 ? -1 : 1;
  if (t < cat.huntUntil) return true;
  pounce(t);
  return true;
}

// Прыжок туда, где курсор. Приземлился, а мышка всё ещё под лапами: поймал.
function pounce(t: number): void {
  cat.huntUntil = 0;
  cat.watchUntil = 0;
  cat.huntCool = t + rand(15_000, 30_000);
  const tx = clamp(mouse.x, CAT_W / 2, W() - CAT_W / 2);
  jumpTo(tx, floorY(), null, () => {
    const caught = Math.abs(mouse.x - cx()) < 70 && low();
    if (caught) {
      happy(1200);
      Sound.meow();
      showPose('heartsSitF', 2500, T('hunt.caught'));
    } else {
      showPose(pick<AnimName>(['earTwitchF', 'blinkSitF']), 2500, T('hunt.missed'));
    }
  });
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
