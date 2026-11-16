// Корзина: кота можно отнести мышкой в Корзину, и он пропадает со стола.
// Вылезает сам, когда нажимают на его значок в трее. Если кот срочно нужен (напоминание,
// мошенники, панель из меню), он выскакивает сразу, без представления.
// Корзину находим системной «доступностью»: на Windows это значок на рабочем столе, на Mac — в Доке.
// Не нашли (значок закрыт окнами, выключен поиск кнопок) — корзины нет, кот просто падает, как обычно.
import type { LocateQuery, Rect } from '../../shared/types';
import { api } from '../core/api';
import { dom, el } from '../core/dom';
import { T } from '../core/i18n';
import { isMac, settings } from '../core/settings';
import { Sound } from '../core/sound';
import { clamp, now } from '../core/util';
import { guide, trainer } from '../guide/state';
import { hideBubble, say } from '../ui/bubble';
import { onFrame } from './behaviour';
import { cat, CAT_H, CAT_W, cx, floorY, G, H, setState, size, W } from './cat';
import { windowAt } from './platforms';
import { happy } from './poses';

const binQuery = (): LocateQuery => (isMac()
  ? { op: 'find', scope: 'taskbar', name: '^(Корзина|Trash)', types: ['Button'] }
  : { op: 'find', scope: 'desktop', name: '^(Корзина|Recycle Bin)$', types: ['ListItem'] });

// Движение кота в корзину и из неё. Координаты — точка между лапами кота.
interface Flight { kind: 'in' | 'out'; t0: number; ms: number; x0: number; y0: number; tx: number; ty: number; vy: number }

let bin: Rect | null = null;   // где корзина, пока кота несут
let asked = 0;                 // номер поиска: поздний ответ старого поиска не нужен
let trashed = false;
let flight: Flight | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];

const glow = el('div', 'trash-glow hidden');
const note = el('div', 'bubble trash-say hidden');

const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
function clearTimers(): void { timers.forEach(clearTimeout); timers = []; }

/** Кот сейчас в корзине (или проваливается в неё). */
export const isTrashed = (): boolean => trashed;

async function findBin(): Promise<Rect | null> {
  if (!settings.locator) return null;
  try {
    const it = (await api.locate(binQuery())).items?.[0];
    if (!it) return null;
    const r = { x: it.x, y: it.y, w: it.w, h: it.h };
    // значок закрыт окном: туда кота не бросить и оттуда он не вылезет
    return !isMac() && windowAt(r.x + r.w / 2, r.y + r.h / 2) ? null : r;
  } catch { return null; }
}

// Середина картинки корзины (у значка на рабочем столе под картинкой ещё подпись).
const mouth = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + Math.min(r.h, r.w) * 0.5];

function showGlow(r: Rect | null, ...cls: string[]): void {
  glow.className = r ? ['trash-glow', ...cls].join(' ') : 'trash-glow hidden';
  if (!r) return;
  const pad = 6;
  Object.assign(glow.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.w + pad * 2}px`, height: `${r.h + pad * 2}px` });
}

// Кот висит над корзиной: середина его тела рядом со значком.
function overBin(r: Rect): boolean {
  const bodyY = cat.y + CAT_H - 50 * size();
  const pad = 45;
  return cx() > r.x - pad && cx() < r.x + r.w + pad && bodyY > r.y - pad && bodyY < r.y + r.h + pad;
}

/** Кота взяли за шкирку: ищем корзину, пока он в воздухе. Во время уроков и подсказок корзины нет. */
export function trashDragStart(): void {
  bin = null;
  const id = ++asked;
  if (trainer.step || guide.active) return;
  void findBin().then((r) => { if (id === asked && cat.state === 'drag') bin = r; });
}

/** Кота отпустили. true — он над корзиной и уже падает в неё. */
export function dropIntoTrash(): boolean {
  asked++;
  const r = bin;
  bin = null;
  setScared(false);
  if (!r || !overBin(r)) { showGlow(null); return false; }
  throwIn(r);
  return true;
}

function throwIn(r: Rect): void {
  clearTimers();
  trashed = true;
  hideBubble();
  // Кот остаётся в том же кадре «за шкирку» и уменьшается в значок: без смены позы он не «вырастает».
  cat.trashIn = true;
  setState('trash');
  const [tx, ty] = mouth(r);
  flight = { kind: 'in', t0: now(), ms: 450, x0: cx(), y0: cat.y + CAT_H, tx, ty, vy: 0 };
  showGlow(r, 'hot');
  later(450, () => {
    flight = null;
    cat.trashIn = false;
    dom.cat.classList.add('trashed');
    dom.cat.style.setProperty('--s', '1');
    Sound.crumple();
    showGlow(r, 'wobble');
  });
  // корзина качнулась — подсветка уходит, на значке ничего не остаётся
  later(1400, () => showGlow(null));
  // подсказка, как достать кота обратно, потом окно кота прячется, как по «Спрятать»
  later(1300, () => { Sound.meow(); showNote(r, T('trash.inside')); });
  later(6000, hideAway);
  // любое нажатие мыши на экране сразу убирает записку (окно кота клики не ловит, спрашиваем систему)
  api.watchClicks(true);
}

// Записка и подсветка пропадают, окно кота прячется, как по «Спрятать».
function hideAway(): void {
  // ещё летит в корзину или уже выпрыгивает: щелчок ничего не ломает
  if (!trashed || flight) return;
  clearTimers();
  api.watchClicks(false);
  note.classList.add('hidden');
  showGlow(null);
  api.hide();
}

function showNote(r: Rect, text: string): void {
  note.textContent = text;
  note.classList.remove('hidden');
  const w = note.offsetWidth || 260;
  const h = note.offsetHeight || 80;
  const left = clamp(r.x + r.w / 2 - w / 2, 8, Math.max(8, W() - w - 8));
  // места сверху нет (корзина в углу экрана): под значком
  const top = r.y - h - 14 > 8 ? r.y - h - 14 : r.y + r.h + 14;
  Object.assign(note.style, { left: `${left}px`, top: `${top}px` });
}

/** Нажали на значок в трее: кот выпрыгивает из корзины. Корзину не видно — выходит из глубины экрана. */
export async function climbOut(): Promise<void> {
  if (!trashed || flight?.kind === 'out') return;
  clearTimers();
  api.watchClicks(false);
  note.classList.add('hidden');
  const r = await findBin();
  if (!trashed) return; // пока искали, кота уже достали
  if (!r) {
    out();
    cat.introRun = true;
    setState('intro');
    cat.onDone = () => say(T('trash.back'), 3500);
    return;
  }
  // корзина шуршит и пищит, потом кот выпрыгивает
  showGlow(r, 'wobble');
  Sound.meow();
  later(1000, () => jumpOut(r));
}

function jumpOut(r: Rect): void {
  cat.trashIn = false;
  dom.cat.classList.remove('trashed');
  Sound.crumple();
  showGlow(r);
  const [x0, y0] = mouth(r);
  const dir = x0 < W() / 2 ? 1 : -1;
  cat.dir = dir;
  const tx = clamp(x0 + dir * 150, CAT_W / 2, W() - CAT_W / 2);
  const ty = H();
  // прыжок вверх над корзиной (но не за край экрана), потом вниз на пол
  const peak = Math.min(y0 - 20, Math.max(Math.min(y0, ty) - 90, 40));
  const vy = -Math.sqrt(2 * G * Math.max(0, y0 - peak));
  const sec = (-vy + Math.sqrt(vy * vy + 2 * G * (ty - y0))) / G;
  const ms = Math.round(clamp(Number.isFinite(sec) ? sec : 0.8, 0.4, 1.4) * 1000);
  flight = { kind: 'out', t0: now(), ms, x0, y0, tx, ty, vy };
  later(ms, () => {
    out();
    cat.x = tx - CAT_W / 2;
    happy();
    say(T('trash.back'), 3500);
  });
}

// Кот снова на полу и виден.
function out(): void {
  clearTimers();
  api.watchClicks(false);
  flight = null;
  trashed = false;
  cat.trashIn = false;
  showGlow(null);
  note.classList.add('hidden');
  dom.cat.classList.remove('trashed');
  dom.cat.style.setProperty('--s', '1');
  cat.plat = null;
  cat.y = floorY();
  setState('idle', 4000);
}

/** Кот срочно нужен (напоминание, мошенники, меню в трее): выскакивает из корзины сразу. */
export function leaveTrash(): void {
  if (trashed) out();
}

// Кот над Корзиной: значок подсвечен, кот дрожит, вырывается от неё и просит не выбрасывать.
let scared = false;
function setScared(on: boolean, r: Rect | null = null): void {
  if (on && r) cat.dir = cx() < r.x + r.w / 2 ? -1 : 1;
  if (on === scared) return;
  scared = on;
  dom.cat.classList.toggle('scared', on);
  if (on) { say(T('trash.nope'), 1800); Sound.meow(); }
}

// Каждый кадр: подсветка корзины, пока кота несут, и полёт в корзину и из неё.
function frame(): void {
  if (cat.state === 'drag') {
    const over = !!bin && overBin(bin);
    showGlow(over ? bin : null, 'hot');
    setScared(over, bin);
    return;
  }
  setScared(false);
  const f = flight;
  // Кота не несут, он не в Корзине и не летит: никакой подсветки у значка не остаётся.
  if (!f && !trashed && !glow.classList.contains('hidden')) showGlow(null);
  if (!f) return;
  const p = clamp((now() - f.t0) / f.ms, 0, 1);
  let x: number, y: number, s: number;
  if (f.kind === 'in') {
    const e = p * p;
    x = f.x0 + (f.tx - f.x0) * e;
    y = f.y0 + (f.ty - f.y0) * e;
    s = Math.max(0.05, 1 - p * (2 - p));   // сразу заметно уменьшается и пропадает в значке
    cat.vy = 1;
  } else {
    const t = (p * f.ms) / 1000;
    x = f.x0 + (f.tx - f.x0) * p;
    y = f.y0 + f.vy * t + 0.5 * G * t * t;
    s = 0.15 + 0.85 * Math.min(1, p / 0.6);
    cat.vy = f.vy + G * t;
  }
  cat.x = x - CAT_W / 2;
  cat.y = y - CAT_H;
  // кот у самого края экрана: рисуем без обычного «не выходи за край», иначе он промахнётся мимо значка
  dom.cat.style.transform = `translate(${Math.round(cat.x)}px, ${Math.round(cat.y)}px)`;
  dom.cat.style.setProperty('--s', s.toFixed(3));
}

export function initTrash(): void {
  document.body.append(glow, note);
  onFrame(frame);
  api.on('global-click', hideAway);
}
