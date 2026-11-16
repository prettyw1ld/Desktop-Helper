/* Кот за шкирку — маятник. Загривок идёт за курсором, а тело отстаёт: тащат вправо — тело отклоняется влево,
   резко остановились — кот раскачивается и успокаивается, держат неподвижно — висит почти ровно.
   Угол в градусах; положительный — низ кота уходит влево (поворот по часовой стрелке вокруг загривка). */

export const SWING = {
  stiffness: 55,     // как быстро тянет обратно вниз: период качания около 0,85 с
  damping: 2.6,      // затухание: после рывка 3–4 заметных качания
  kick: 0.16,        // насколько рывок мыши (изменение скорости, px/с) раскачивает тело, °/с на px/с
  lean: 0.008,       // наклон «против ветра» при ровном движении, ° на px/с
  maxLean: 12,
  maxAngle: 30,
  maxDv: 2500,       // один кадр рывка не больше: дрожащая мышь не должна закручивать кота
  sideOn: 450,       // несут быстрее, px/с — кот поворачивается боком, мордой туда, куда несут
  sideOff: 150,      // медленнее этого дольше calmMs — снова висит анфас
  calmMs: 350,
};

export interface Swing { angle: number; vel: number; x: number | null; v: number; face: -1 | 0 | 1; calm: number }

export const newSwing = (): Swing => ({ angle: 0, vel: 0, x: null, v: 0, face: 0, calm: 0 });

/** Маятник кота на экране. */
export const swing = newSwing();

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Шаг маятника: x — где сейчас загривок (null — кота никто не держит), dt в секундах. Возвращает угол. */
export function swingStep(s: Swing, x: number | null, dt: number): number {
  if (dt <= 0) return s.angle;
  if (x === null) {
    // отпустили: качание быстро гаснет (кот уже падает или стоит)
    s.x = null;
    s.v = 0;
    s.vel = 0;
    s.angle *= Math.exp(-14 * dt);
    if (Math.abs(s.angle) < 0.05) s.angle = 0;
    return s.angle;
  }
  if (s.x === null) { s.x = x; s.v = 0; }
  // скорость загривка сглажена: мышь отдаёт рывками, 30 кадров в секунду
  const raw = (x - s.x) / dt;
  const v = s.v + (raw - s.v) * 0.5;
  const dv = clamp(v - s.v, -SWING.maxDv, SWING.maxDv);
  s.x = x;
  s.v = v;
  const rest = clamp(v * SWING.lean, -SWING.maxLean, SWING.maxLean);
  s.vel += dv * SWING.kick;
  s.vel += (-SWING.stiffness * (s.angle - rest) - SWING.damping * s.vel) * dt;
  s.angle += s.vel * dt;
  if (Math.abs(s.angle) > SWING.maxAngle) { s.angle = Math.sign(s.angle) * SWING.maxAngle; s.vel *= -0.3; }
  return s.angle;
}

/** Куда кот смотрит, пока его несут: 0 — анфас, 1 — боком вправо, -1 — влево. С запасом, чтобы поза не мигала. */
export function carryFacing(s: Swing, t: number): -1 | 0 | 1 {
  const v = s.x === null ? 0 : s.v;
  if (Math.abs(v) > SWING.sideOn) { s.face = v > 0 ? 1 : -1; s.calm = t; }
  else if (Math.abs(v) > SWING.sideOff) s.calm = t;
  else if (s.face && t - s.calm > SWING.calmMs) s.face = 0;
  return s.face;
}

/** Кота только что подняли: он слегка качнётся, как от рывка вверх. */
export function swingPickUp(s: Swing, dir: number): void {
  s.x = null;
  s.face = 0;
  s.vel = 70 * (dir < 0 ? 1 : -1);
}
