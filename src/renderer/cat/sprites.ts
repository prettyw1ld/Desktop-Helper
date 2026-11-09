/* Кот: спрайт-листы 64×64 (design/cats/*.aseprite → assets/cats/*.png).
   Лист 14 кадров в ширину, одна анимация на строку. Подписи строк в design/cats/*_labeled.png.
   Важно: в подписях «Walk right/left» перепутаны местами, здесь всё названо по тому,
   куда кот смотрит на экране (L = влево, R = вправо). */
import type { CatColor } from '../../shared/types';
import { FRONT_HEAD, TURNED_HEAD } from './head-spans';

const SIZE = 64;
export const COLORS: CatColor[] = ['ginger', 'white', 'black'];

/** Анимация: строка листа, кадры, скорость; once — проиграть один раз и замереть на последнем кадре. */
export interface Anim { row: number; frames: number[]; fps?: number; once?: boolean }

// Нижний край лап в каждой строке (px внутри кадра 64×64), чтобы кот стоял на полу ровно.
const FEET: number[] = [48, 53, 55, 53, 48, 48, 46, 49, 60, 54, 48, 48, 48, 47, 48, 46, 53, 48, 48, 48, 48, 48, 48, 53, 51, 48,
  48, 47, 47, 56, 56, 51, 48, 48, 48, 48, 50, 50, 48, 48, 48, 48, 48, 48, 46, 46, 45, 45, 42, 42, 42, 42, 44, 44, 45,
  45, 53, 51, 48, 48, 48, 48, 52, 48, 48, 48];

// row: строка листа; frames: номера кадров (по умолчанию 0..n-1); fps; once: проиграть один раз и замереть.
const seq = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const BASE = {
  // статичные позы
  sitF: { row: 0, frames: [0] }, sitB: { row: 0, frames: [1] }, sitL: { row: 0, frames: [2] }, sitR: { row: 0, frames: [3] },
  standF: { row: 1, frames: [0] }, standB: { row: 1, frames: [1] }, standL: { row: 1, frames: [2] }, standR: { row: 1, frames: [3] },
  lieF_L: { row: 6, frames: [0] }, lieF_R: { row: 6, frames: [1] },
  sitTail: { row: 7, frames: [0] }, lieL: { row: 7, frames: [1] }, lieR: { row: 7, frames: [2] },
  // ходьба и бег
  walkDown: { row: 2, frames: seq(6), fps: 8 }, walkUp: { row: 3, frames: seq(6), fps: 8 },
  walkL: { row: 4, frames: seq(6), fps: 9 }, walkR: { row: 5, frames: seq(6), fps: 9 },
  runDown: { row: 8, frames: seq(4), fps: 11 }, runUp: { row: 9, frames: seq(4), fps: 11 },
  runR: { row: 10, frames: seq(5), fps: 12 }, runL: { row: 11, frames: seq(5), fps: 12 },
  // умывание, мяуканье, чесание
  lickSit: { row: 12, frames: seq(8), fps: 7 }, lickLie: { row: 13, frames: seq(8), fps: 7 },
  meowSit: { row: 14, frames: [0, 1, 2, 2, 1, 0], fps: 8 }, meowLie: { row: 15, frames: [0, 1, 2, 2, 1, 0], fps: 8 },
  meowStand: { row: 16, frames: [0, 1, 2, 2, 1, 0], fps: 8 },
  scratchL: { row: 17, frames: seq(8), fps: 10 }, scratchR: { row: 18, frames: seq(8), fps: 10 },
  // хвост
  wagSitF: { row: 19, frames: seq(5), fps: 6 }, wagSitB: { row: 20, frames: seq(5), fps: 6 },
  wagSitL: { row: 21, frames: seq(5), fps: 6 }, wagSitR: { row: 22, frames: seq(5), fps: 6 },
  wagStandF: { row: 23, frames: seq(5), fps: 6 }, wagStandB: { row: 24, frames: seq(5), fps: 6 },
  wagStandL: { row: 25, frames: seq(5), fps: 6 }, wagStandR: { row: 26, frames: seq(5), fps: 6 },
  wagLieL: { row: 27, frames: seq(3), fps: 4 }, wagLieR: { row: 28, frames: seq(3), fps: 4 },
  // взмах лапой: так кот показывает на кнопку и играет
  swipeStandF: { row: 29, frames: seq(11), fps: 12 }, swipeStandF2: { row: 30, frames: seq(11), fps: 12 },
  swipeStandB: { row: 31, frames: seq(5), fps: 8 },
  swipeStandL: { row: 32, frames: seq(11), fps: 12 }, swipeStandL2: { row: 33, frames: seq(11), fps: 12 },
  swipeStandR: { row: 34, frames: seq(11), fps: 12 }, swipeStandR2: { row: 35, frames: seq(11), fps: 12 },
  swipeSitF: { row: 36, frames: seq(11), fps: 12 }, swipeSitF2: { row: 37, frames: seq(11), fps: 12 },
  swipeSitB: { row: 38, frames: seq(5), fps: 8 },
  swipeSitL: { row: 39, frames: seq(11), fps: 12 }, swipeSitL2: { row: 40, frames: seq(11), fps: 12 },
  swipeSitR: { row: 41, frames: seq(11), fps: 12 }, swipeSitR2: { row: 42, frames: seq(11), fps: 12 },
  // зевок и сон (6 разных поз сна)
  yawn: { row: 43, frames: seq(7), fps: 6, once: true },
  sleep1L: { row: 44, frames: [0, 1], fps: 1.2 }, sleep1R: { row: 45, frames: [0, 1], fps: 1.2 },
  sleepBackL: { row: 46, frames: [0, 1], fps: 1.2 }, sleepBackR: { row: 47, frames: [0, 1], fps: 1.2 },
  sleep2L: { row: 48, frames: [0, 1], fps: 1.2 }, sleep2R: { row: 49, frames: [0, 1], fps: 1.2 },
  sleep3L: { row: 50, frames: [0, 1], fps: 1.2 }, sleep3R: { row: 51, frames: [0, 1], fps: 1.2 },
  sleep4L: { row: 52, frames: [0, 1], fps: 1.2 }, sleep4R: { row: 53, frames: [0, 1], fps: 1.2 },
  sleep5L: { row: 54, frames: [0, 1], fps: 1.2 }, sleep5R: { row: 55, frames: [0, 1], fps: 1.2 },
  // еда, шипение, прыжки, стойка на задних лапах
  eatF: { row: 56, frames: seq(10), fps: 8 }, eatB: { row: 57, frames: seq(8), fps: 8 },
  eatL: { row: 58, frames: seq(10), fps: 8 }, eatR: { row: 59, frames: seq(10), fps: 8 },
  hissL: { row: 60, frames: [0, 1], fps: 4 }, hissR: { row: 61, frames: [0, 1], fps: 4 },
  jumpB: { row: 62, frames: seq(3), fps: 6 }, jumpL: { row: 63, frames: seq(5), fps: 8 }, jumpR: { row: 64, frames: seq(5), fps: 8 },
  hind: { row: 65, frames: [0, 1, 2, 3, 2, 1], fps: 6 },
} satisfies Record<string, Anim>;

// Строки 66+ собраны из нарисованных кадров скриптом tools/make_extra_sprites.py
// (слой «Generated» в design/cats/*.aseprite): моргание, Zzz, сердечки и т.п.
// XBASE: для каждой такой строки нарисованная строка, чьи лапы (FEET) она повторяет,
// или { feet } — нижний край кадра, если поза своя (кот висит за шкирку).
const XROW = 66;
const XBASE: (number | { feet: number })[] = [0, 19, 6, 6, 1, 0, 0, 0, 1, 20, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, { feet: 56 }, 0, 0, { feet: 45 }, { feet: 45 }, { feet: 45 }, { feet: 45 }];
XBASE.forEach((r, i) => { FEET[XROW + i] = typeof r === 'number' ? FEET[r] ?? 48 : r.feet; });
const x = (row: number, frames: number[], fps?: number, extra: Partial<Anim> = {}): Anim => ({ row: XROW + row, frames, fps, ...extra });
const blinkSeq = (open: number, closed: number, n = 18): number[] => [...Array(n).fill(open), closed, open, open, closed];
const EXTRA = {
  // моргание: сидит, сидит виляя хвостом, лежит, стоит
  blinkSitF: x(0, blinkSeq(0, 1), 8),
  wagBlinkSitF: x(1, [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4], 6),
  blinkLieL: x(2, blinkSeq(0, 1, 14), 6), blinkLieR: x(3, blinkSeq(0, 1, 14), 6),
  blinkStandF: x(4, blinkSeq(0, 1, 14), 7),
  earTwitchF: x(5, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 8),
  hopF: x(6, [0, 1, 2, 3, 4, 5, 0, 0, 0], 14),
  heartsSitF: x(7, [0, 1, 2, 3], 4),
  surpriseF: x(8, [0, 1, 2, 3], 10, { once: true }),
  thinkB: x(9, [0, 1, 2, 3, 4, 5, 6, 7], 3),
  // сон с Zzz (на каждую позу сна и сторону): сначала пусто, потом z, zz, zzz
  sleep1ZL: x(10, seq(8), 1.3), sleep1ZR: x(11, seq(8), 1.3),
  sleepBackZL: x(12, seq(8), 1.3), sleepBackZR: x(13, seq(8), 1.3),
  sleep2ZL: x(14, seq(8), 1.3), sleep2ZR: x(15, seq(8), 1.3),
  sleep3ZL: x(16, seq(8), 1.3), sleep3ZR: x(17, seq(8), 1.3),
  sleep4ZL: x(18, seq(8), 1.3), sleep4ZR: x(19, seq(8), 1.3),
  sleep5ZL: x(20, seq(8), 1.3), sleep5ZR: x(21, seq(8), 1.3),
  // кота держат за шкирку (пока перетаскивают): болтает хвостом и задними лапами, моргает
  scruffF: x(22, seq(8), 6),
  // поворот головы за курсором: кадры 0..6 — голова от «влево» до «вправо», 7..13 — то же с закрытыми глазами;
  // рисуются не как анимация, а по одному кадру через CatSprite.drawLook
  lookSitF: x(23, seq(14)), lookUpSitF: x(24, seq(14)),
  // лежит мордой к курсору: хвост то налево, то вверх, то направо, раз моргает; удар передней лапой
  lieWatchL: x(25, seq(14), 5), lieWatchR: x(26, seq(14), 5),
  lieSwipeL: x(27, seq(6), 10), lieSwipeR: x(28, seq(6), 10),
} satisfies Record<string, Anim>;

export const ANIM = { ...BASE, ...EXTRA };
export type AnimName = keyof typeof ANIM;

/** Сторона, куда смотрит кот: -1 влево, 1 вправо. */
export type Dir = -1 | 1;

// dirAnim('walk', -1) → 'walkL'
export const dirAnim = <B extends string>(base: B, dir: number): `${B}L` | `${B}R` => `${base}${dir < 0 ? 'L' : 'R'}`;

/** Конкретный кадр: для прыжка, где кадр зависит от фазы полёта. */
export interface Frame { row: number; col: number }

/** Сидит лицом к нам и смотрит на курсор: gaze от -GAZE_MAX (влево) до GAZE_MAX (вправо). */
export interface HeadTurn { gaze: number; up: boolean; blink: boolean }
export const GAZE_MAX = 3;

export class CatSprite {
  private readonly ctx: CanvasRenderingContext2D | null; // null там, где холста нет (тесты)
  private readonly sheets = new Map<CatColor, HTMLImageElement>();
  private color: CatColor = 'white';
  private shown = '';

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.ctx = canvas.getContext('2d');
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
  }

  setColor(color: string, base: string): void {
    this.color = COLORS.includes(color as CatColor) ? color as CatColor : 'white';
    if (!this.sheets.has(this.color)) {
      const img = new Image();
      img.src = `${base}${this.color}.png`;
      this.sheets.set(this.color, img);
    }
    this.shown = '';
  }

  /** Какой кадр анимации показать через t мс от её начала. done: анимация once закончилась. */
  static at(name: AnimName, t: number): Frame & { done: boolean } {
    const a: Anim = ANIM[name] ?? ANIM.sitF;
    const fps = a.fps || 1;
    let i = Math.floor((t / 1000) * fps);
    const done = !!a.once && i >= a.frames.length;
    i = a.once ? Math.min(i, a.frames.length - 1) : i % a.frames.length;
    return { row: a.row, col: a.frames[i] ?? 0, done };
  }

  /** t: время от начала анимации в мс. Возвращает true, если анимация once закончилась. */
  draw(name: AnimName, t: number): boolean {
    const f = CatSprite.at(name, t);
    this.frame(f.row, f.col);
    return f.done;
  }

  /**
   * Кот смотрит на курсор: туловище с виляющим хвостом из wagSitF, а голова из нарисованных
   * кадров поворота (lookSitF, lookUpSitF). Голова и шея нарисованы одним куском, поэтому
   * голова не отрывается от тела.
   */
  drawLook(t: number, h: HeadTurn): void {
    const body = CatSprite.at('wagSitF', t);
    const look = (h.up ? ANIM.lookUpSitF : ANIM.lookSitF).row;
    const col = Math.max(-GAZE_MAX, Math.min(GAZE_MAX, h.gaze)) + GAZE_MAX + (h.blink ? 2 * GAZE_MAX + 1 : 0);
    const img = this.sheets.get(this.color);
    const key = `${this.color}:look:${body.col}:${look}:${col}`;
    const ctx = this.ctx;
    if (!ctx || !img || !img.complete || !img.naturalWidth || key === this.shown) return;
    this.shown = key;
    const dy = SIZE - (FEET[body.row] ?? 48) - 2;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, body.col * SIZE, body.row * SIZE, SIZE, SIZE, 0, dy, SIZE, SIZE);
    for (const [y, x1, x2] of FRONT_HEAD) ctx.clearRect(x1, dy + y, x2 - x1 + 1, 1);
    for (const [y, x1, x2] of TURNED_HEAD) {
      ctx.drawImage(img, col * SIZE + x1, look * SIZE + y, x2 - x1 + 1, 1, x1, dy + y, x2 - x1 + 1, 1);
    }
  }

  frame(row: number, col: number): void {
    const img = this.sheets.get(this.color);
    const key = `${this.color}:${row}:${col}`;
    if (!this.ctx || !img || !img.complete || !img.naturalWidth || key === this.shown) return;
    this.shown = key;
    const dy = SIZE - (FEET[row] ?? 48) - 2; // ставим лапы на нижний край холста
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    this.ctx.drawImage(img, col * SIZE, row * SIZE, SIZE, SIZE, 0, dy, SIZE, SIZE);
  }
}
