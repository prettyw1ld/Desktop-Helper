// Поглаживание: человек водит мышкой туда-сюда по коту, не нажимая кнопку.
// Здесь только распознавание по движениям курсора; что делает кот, решает mouse.ts.

export const STROKE = {
  minMs: 900,      // гладят хотя бы столько времени
  minPath: 380,    // и курсор прошёл по коту хотя бы столько пикселей (при размере кота 1)
  minTurns: 2,     // и хотя бы два раза поменял направление: туда-сюда, а не просто мимо
  pauseMs: 700,    // курсор замер на коте дольше: поглаживание закончилось
  leaveMs: 450,    // курсор соскочил с кота ненадолго: не страшно, продолжаем
  repeatMs: 2600,  // пока гладят дальше, кот радуется снова раз в столько
  coolMs: 1500,    // после радости новое поглаживание засчитываем не раньше
  turnPx: 4,       // движения мельче этого не считаем сменой направления (дрожь руки)
} as const;

export type StrokeEvent = 'pet' | 'more' | null;

interface Session { t0: number; path: number; turns: number; dirX: number; dirY: number; lastMove: number; lastOver: number; nextMore: number; fired: boolean }

export class StrokeDetector {
  private s: Session | null = null;
  private last: { x: number; y: number } | null = null;
  private lastFire = -Infinity;

  /** Гладят ли кота прямо сейчас (уже засчитано или ещё набирается). */
  active(t: number): boolean {
    const s = this.s;
    return !!s && s.path > 0 && t - s.lastMove < STROKE.pauseMs && t - s.lastOver < STROKE.leaveMs;
  }

  reset(): void {
    this.s = null;
    this.last = null;
  }

  /**
   * Очередное положение курсора. over: курсор над котом; scale: размер кота.
   * 'pet' — только что засчитали поглаживание; 'more' — гладят дальше; null — ничего.
   */
  feed(x: number, y: number, t: number, over: boolean, scale = 1): StrokeEvent {
    const prev = this.last;
    this.last = { x, y };
    let s = this.s;
    if (s && (t - s.lastMove > STROKE.pauseMs || t - s.lastOver > STROKE.leaveMs)) s = this.s = null;
    if (!over) return null;
    if (!s) {
      s = this.s = { t0: t, path: 0, turns: 0, dirX: 0, dirY: 0, lastMove: t, lastOver: t, nextMore: 0, fired: false };
      return null;
    }
    s.lastOver = t;
    if (!prev) return null;
    const dx = x - prev.x;
    const dy = y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return null;
    s.lastMove = t;
    s.path += d;
    // смена направления по горизонтали или по вертикали: гладят туда-сюда
    if (Math.abs(dx) >= STROKE.turnPx) {
      const dir = Math.sign(dx);
      if (s.dirX && dir !== s.dirX) s.turns++;
      s.dirX = dir;
    }
    if (Math.abs(dy) >= STROKE.turnPx) {
      const dir = Math.sign(dy);
      if (s.dirY && dir !== s.dirY) s.turns++;
      s.dirY = dir;
    }
    if (s.fired) {
      if (t < s.nextMore) return null;
      s.nextMore = t + STROKE.repeatMs;
      this.lastFire = t;
      return 'more';
    }
    if (t - s.t0 < STROKE.minMs || s.path < STROKE.minPath * scale || s.turns < STROKE.minTurns) return null;
    if (t - this.lastFire < STROKE.coolMs) return null;
    s.fired = true;
    s.nextMore = t + STROKE.repeatMs;
    this.lastFire = t;
    return 'pet';
  }
}

/** Один на окно кота: mouse.ts кормит его движениями, слежка за курсором спрашивает, гладят ли. */
export const strokes = new StrokeDetector();
