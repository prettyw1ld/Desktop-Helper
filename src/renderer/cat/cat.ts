// Состояние кота, его размеры на экране и простые движения: идти, прыгать, падать.
import { dom } from '../core/dom';
import { settings } from '../core/settings';
import { clamp, now, pick } from '../core/util';
import { dirAnim, type AnimName, type Dir } from './sprites';

/**
 * idle — сидит без дела; walk — идёт; sleep — спит; act — показывает позу (умывается, зевает…);
 * drag — его несут за шкирку; fall, jump — в воздухе; busy — занят человеком (открыта панель, подсказка);
 * perch — стоит у кнопки и показывает на неё; intro, outro — выходит из глубины экрана и уходит туда;
 * trash — сидит в Корзине (или летит в неё и из неё), см. trash.ts.
 */
export type CatState = 'idle' | 'walk' | 'sleep' | 'act' | 'drag' | 'fall' | 'jump' | 'busy' | 'perch' | 'intro' | 'outro' | 'trash';

export interface Jump {
  t0: number;
  dur: number;
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  plat: number | null;          // на какое окно приземлится
  after: (() => void) | null;   // что сделать после приземления (один раз)
  vertical: boolean;            // прыжок почти на месте: другие кадры
}

export const cat = {
  x: 0,
  y: 0,
  vy: 0,
  trashIn: false,             // кота бросили в Корзину: он летит в неё, всё так же висящим за шкирку
  dir: -1 as Dir,
  state: 'idle' as CatState,
  prev: 'idle' as CatState,  // прошлое состояние: после ходьбы и прыжка кот сначала стоит
  until: now() + 1500,        // когда закончится текущее состояние
  since: now(),               // когда оно началось
  targetX: 0,
  running: false,
  plat: null as number | null,                       // окно, на котором стоит кот
  climb: null as { id: number; cx: number } | null,  // собирается запрыгнуть на окно
  jump: null as Jump | null,
  onArrive: null as (() => void) | null,             // дошёл, куда шёл
  afterLand: null as (() => void) | null,            // упал и приземлился
  onDone: null as (() => void) | null,               // закончил выход (intro) или уход (outro)
  introRun: false,
  act: 'sitF' as AnimName,                           // поза в состоянии act
  idlePose: 'wagSitF' as AnimName,
  sleepKind: 'sleep1ZL' as AnimName,
  happyAnim: 'hind' as AnimName,
  lookPose: 'standF' as AnimName,                    // быстрый взгляд на кнопку перед прыжком
  lookUntil: 0,
  meowUntil: 0,                                      // открывает рот, пока говорит
  lastPet: Date.now(),
  wantsAttention: false,
  // слежка за курсором
  watchUntil: 0,
  // куда повёрнута голова (-3..3), куда её ведём, смотрит ли вверх; когда повернул и когда моргнёт
  head: { gaze: 0, target: 0, up: false, turnedAt: 0, blinkAt: 0 },
  swipeUntil: 0,
  swipeCool: 0,
  swipePose: 'swipeSitL' as AnimName,
  swipes: 0,                                         // сколько раз подряд ударил по курсору
  // лежит и караулит курсор: до какого времени (0 — не лежит) и когда можно снова
  huntUntil: 0,
  huntCool: 0,
};

// ---------- Размеры ----------
export const CAT_W = 150;
export const CAT_H = 140;
// Где загривок у кота за шкирку (кадр scruffF), в px от верха блока кота при размере 1:
// холст 192px стоит низом на низ блока (140px), загривок на 15-м пикселе кадра 64×64 (×3).
export const SCRUFF_Y = CAT_H - 192 + 15 * 3;
export const G = 2200; // гравитация, px/с²

// Окно закрывает весь экран вместе с панелью задач; кот живёт в рабочей области над ней.
// work приходит из главного процесса; пока не пришло — всё окно.
const work = { right: 0, bottom: 0 };
export function setWorkArea(r: { x: number; y: number; w: number; h: number }): void {
  work.right = Math.max(0, r.x + r.w);
  work.bottom = Math.max(0, r.y + r.h);
}
export const W = (): number => Math.min(window.innerWidth, work.right || window.innerWidth);
export const H = (): number => Math.min(window.innerHeight, work.bottom || window.innerHeight);
export const size = (): number => Number(settings.size) || 1;
export const floorY = (): number => H() - CAT_H;
export const cx = (): number => cat.x + CAT_W / 2;                 // центр кота по горизонтали
export const visTop = (): number => cat.y + CAT_H * (1 - size());  // верх кота с учётом размера

// ---------- Состояния ----------
const IDLE_POSES = (): AnimName[] => [
  'wagBlinkSitF', 'wagBlinkSitF', 'blinkSitF', 'earTwitchF', 'blinkStandF', 'wagStandF', 'sitTail',
  dirAnim('wagSit', cat.dir), dirAnim('sit', cat.dir),
];

/** Новое состояние на ms миллисекунд (без ms — пока его не сменят). */
export function setState(state: CatState, ms?: number): void {
  cat.prev = cat.state;
  cat.state = state;
  cat.until = ms ? now() + ms : Infinity;
  cat.since = now();
  if (state !== 'walk') { cat.running = false; cat.onArrive = null; }
  cat.watchUntil = 0;
  cat.huntUntil = 0;
  if (state === 'idle') cat.idlePose = pick(IDLE_POSES());
  dom.cat.classList.toggle('dragging', state === 'drag');
}

/** Кота сейчас несут за шкирку. Функция, а не сравнение: состояние меняется между await. */
export const isDragged = (): boolean => cat.state === 'drag';

export const inAir = (): boolean => ['drag', 'fall', 'jump', 'perch'].includes(cat.state);

export function walkTo(centerX: number, run = false, onArrive: (() => void) | null = null): void {
  cat.targetX = centerX - CAT_W / 2;
  cat.dir = cat.targetX > cat.x ? 1 : -1;
  setState('walk');
  cat.running = run;
  cat.onArrive = onArrive;
}

export function startFall(): void {
  cat.vy = 0;
  cat.plat = null;
  setState('fall');
}

/** Прыжок по дуге в точку (центр по x, верх кота по y). plat: на какое окно приземлится. */
export function jumpTo(centerX: number, y: number, plat: number | null = null, after: (() => void) | null = null): void {
  const x0 = cat.x;
  const y0 = cat.y;
  const tx = centerX - CAT_W / 2;
  const dist = Math.abs(tx - x0);
  const dur = clamp(0.45 + Math.sqrt(Math.max(0, y0 - y)) / 55 + dist / 2600, 0.45, 1.3);
  cat.jump = {
    t0: now(), dur, x0, y0, tx, ty: y,
    vx: (tx - x0) / dur, vy: (y - y0 - 0.5 * G * dur * dur) / dur,
    plat, after, vertical: dist < 50,
  };
  if (dist >= 4) cat.dir = tx > x0 ? 1 : -1;
  setState('jump');
}

/** Сначала спуститься на пол (если кот на окне или у кнопки), потом then. */
export function landThen(then: () => void): void {
  if (cat.plat || cat.state === 'perch') { cat.afterLand = then; startFall(); } else then();
}
