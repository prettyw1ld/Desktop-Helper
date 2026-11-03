/* Жизнь кота, когда человеку от него ничего не нужно: чем заняться, какую позу показать
   и как следить за мышкой. Физика (ходьба, прыжки, падение) и общие помощники живут в app.js;
   этот файл подключается раньше и вызывает их только из функций, когда app.js уже загружен. */

// Как долго кот держит одно занятие, мс [от, до]. Больше числа: спокойнее кот.
const LIFE = {
  idle: [9000, 20000],      // сидит или стоит в одной позе
  afterWalk: [5000, 10000], // дошёл и постоял
  afterLand: [3000, 6000],  // приземлился
  act: [7000, 13000],       // умывается, ест, играет
  watch: [10000, 20000],    // следит за мышкой
  watchBored: 7000,         // мышка столько не двигалась: следить скучно
  sleep: [45000, 100000],
  settle: 900,              // после ходьбы и прыжка кот сначала стоит, потом садится
};

// Чем заняться дальше: вероятности, в сумме 1.
const CHOICES = { climb: 0.08, walk: 0.26, idle: 0.36, watch: 0.06, sleep: 0.08, act: 0.16 };
// Мышка недавно двигалась: кот охотнее за ней следит.
const CHOICES_MOUSE = { climb: 0.07, walk: 0.22, idle: 0.25, watch: 0.28, sleep: 0.04, act: 0.14 };

const between = ([a, b]) => rand(a, b);

// Чем кот занимается сам, когда ему скучно. Все анимации из листа.
const ACTS = [
  { anim: () => 'lickSit', text: 'act.grooming' },
  { anim: () => 'lickLie', text: 'act.grooming' },
  { anim: () => dirAnim('scratch', cat.dir) },
  { anim: () => 'yawn', text: 'act.yawn', ms: 1400 },
  { anim: () => pick(['eatF', 'eatB', dirAnim('eat', cat.dir)]), text: 'act.eating' },
  { anim: () => dirAnim('wagLie', cat.dir), text: 'act.rolling' },
  { anim: () => pick(['swipeSitF', 'swipeSitF2', dirAnim('swipeSit', cat.dir), `${dirAnim('swipeSit', cat.dir)}2`]), text: 'act.playing' },
  { anim: () => pick([dirAnim('swipeStand', cat.dir), `${dirAnim('swipeStand', cat.dir)}2`, 'swipeStandF', 'swipeStandF2']), text: 'act.tailChasing' },
  { anim: () => pick(['swipeSitB', 'swipeStandB']), text: 'act.knocking' },
  { anim: () => 'hind', text: 'act.birdWatching' },
  { anim: () => 'meowLie' },
  { anim: () => pick(['lieL', 'lieR', 'lieF_L', 'lieF_R']) },
];

// Поза для спокойного «сижу/стою», выбирается один раз на всё время idle.
function pickIdlePose() {
  return pick(['wagSitF', 'wagSitF', 'wagStandF', 'sitTail', dirAnim('wagSit', cat.dir), dirAnim('sit', cat.dir)]);
}

function roll(weights) {
  let r = Math.random();
  for (const [k, w] of Object.entries(weights)) { r -= w; if (r < 0) return k; }
  return 'idle';
}

function decideNext() {
  if (guide.active || trainer.step) return setState(cat.state === 'perch' ? 'perch' : 'busy');
  if (openPanel) return setState('busy');
  const weights = mouse.movedRecently() ? CHOICES_MOUSE : CHOICES;
  let choice = roll(weights);
  // одно и то же активное занятие два раза подряд выглядит суетливо: перебрасываем один раз
  if (choice === cat.lastChoice && choice !== 'idle') choice = roll(weights);
  if (choice === 'climb' && (currentPlat() || !settings.windows || !platforms.length)) choice = 'walk';
  cat.lastChoice = choice;

  switch (choice) {
    case 'climb': return climbWindow();
    case 'walk': return wander();
    case 'watch': return watchMouse();
    case 'sleep': return goSleep(between(LIFE.sleep));
    case 'act': {
      const a = pick(ACTS);
      return showPose(a.anim(), a.ms || between(LIFE.act), a.text && Math.random() < 0.5 ? T(a.text) : '');
    }
    default: return setState('idle', between(LIFE.idle));
  }
}

// Подойти к окну и запрыгнуть на его верхний край.
function climbWindow() {
  const target = pick(platforms);
  const land = rand(target.x1 + 40, target.x2 - 40);
  const side = cx() < land ? -1 : 1;
  const from = clamp(land + side * rand(80, 160), CAT_W / 2, W() - CAT_W / 2);
  cat.climb = { id: target.id, cx: land };
  walkTo(from, Math.abs(from - cx()) > 450);
  const s = T('say.climb');
  if (s && Math.random() < 0.5) say(s, 2000);
}

// Прогуляться по полу или по окну, на котором сидим (иногда спрыгнуть с края).
function wander() {
  const p = currentPlat();
  if (p) {
    const off = Math.random() < 0.2;
    walkTo(off ? pick([p.x1 - 70, p.x2 + 70]) : rand(p.x1 + 25, p.x2 - 25));
    return;
  }
  let goal = rand(20 + CAT_W / 2, W() - CAT_W / 2 - 20);
  if (Math.abs(goal - cx()) < 60) goal = cx() > W() / 2 ? cx() - 200 : cx() + 200;
  walkTo(goal, Math.abs(goal - cx()) > 450 && Math.random() < 0.4);
}

function goSleep(ms) {
  const kind = pick(['sleep1', 'sleep2', 'sleep3', 'sleep4', 'sleep5', 'sleepBack']);
  cat.sleepKind = dirAnim(kind, cat.dir);
  setState('sleep', ms);
}

// ---------- Слежка за мышкой ----------
// Кот садится (или встаёт) спиной к нам и поворачивает голову туда, где курсор.
const mouse = {
  x: -1, y: -1, movedAt: -Infinity, polling: false, polledAt: 0,
  // события мыши приходят в окно кота сами (окно прозрачное и пропускает клики дальше)
  seen(x, y) {
    if (Math.abs(x - this.x) + Math.abs(y - this.y) > 3) this.movedAt = now();
    this.x = x; this.y = y;
  },
  movedRecently: () => now() - mouse.movedAt < 4000,
  // над панелью задач и окнами «поверх всех» события не приходят: спрашиваем систему
  poll(t) {
    if (!api.cursor || this.polling || t - this.polledAt < 90) return;
    this.polling = true;
    this.polledAt = t;
    api.cursor().then((p) => { if (p) this.seen(p.x, p.y); }).catch(() => {}).finally(() => { this.polling = false; });
  },
};

function watchMouse() {
  cat.watch = { pose: pick(['wagSitB', 'wagSitB', 'wagStandB']), hx: 0, hy: 0, turnedAt: 0 };
  setState('watch', between(LIFE.watch));
}

// Куда повернуть голову: на сколько пикселей листа (±3 вбок, ±1 вверх/вниз).
function gazeTarget() {
  if (mouse.x < 0) return [0, 0];
  const dx = mouse.x - cx();
  const dy = mouse.y - (cat.y + CAT_H - 120 * size()); // голова примерно на 120 px выше лап
  const hx = Math.round(3 * Math.tanh(dx / 260));
  const hy = dy < -90 ? -1 : dy > 160 ? 1 : 0;
  return [hx, hy];
}

function updateWatch(t) {
  mouse.poll(t);
  const w = cat.watch;
  // голова поворачивается по пикселю за раз, а не прыгает
  if (t - w.turnedAt > 80) {
    const [tx, ty] = gazeTarget();
    if (tx !== w.hx || ty !== w.hy) {
      w.hx += Math.sign(tx - w.hx);
      w.hy += Math.sign(ty - w.hy);
      w.turnedAt = t;
    }
  }
  // мышка давно стоит: коту надоело
  if (t - cat.since > 4000 && t - mouse.movedAt > LIFE.watchBored) cat.until = t;
}

// ---------- Что показать в этом кадре ----------
// Имя анимации, конкретный кадр {row, col} или {watch, hx, hy} для слежки за мышкой.
function pickAnim(t) {
  const d = cat.dir;
  if (catEl.classList.contains('happy')) return 'hind';
  if (cat.lookUntil && t < cat.lookUntil) return cat.lookPose;
  const talking = t < cat.meowUntil;
  switch (cat.state) {
    case 'walk': return dirAnim(cat.running ? 'run' : 'walk', d);
    case 'intro': return cat.introRun ? 'runDown' : 'walkDown';
    case 'outro': return 'walkUp';
    case 'sleep': {
      const e = t - cat.since;
      if (e < 1200) return 'yawn';
      if (e < 2400) return d < 0 ? 'lieF_L' : 'lieF_R';
      return cat.sleepKind || 'sleep1L';
    }
    case 'drag': return 'meowStand';
    case 'fall': return cat.vy < 0 ? { row: ANIM.jumpB.row, col: 1 } : { row: ANIM[dirAnim('jump', d)].row, col: 2 };
    case 'jump': {
      const j = cat.jump;
      const p = (t - j.t0) / 1000 / j.dur;
      if (j.vertical) return { row: ANIM.jumpB.row, col: p < 0.5 ? 1 : 2 };
      return { row: ANIM[dirAnim('jump', d)].row, col: p < 0.12 ? 1 : p < 0.85 ? 2 : 3 };
    }
    case 'act': return cat.act;
    case 'watch': return talking ? 'meowSit' : { watch: cat.watch.pose, hx: cat.watch.hx, hy: cat.watch.hy };
    case 'perch': {
      if (catEl.classList.contains('thinking')) return 'wagStandB';
      if (talking) return 'meowStand';
      // показываем лапкой на кнопку, потом немного ждём, виляя хвостом
      const e = (t - cat.since) % 3600;
      return e < 1800 ? dirAnim('swipeStand', d) : dirAnim('wagStand', d);
    }
    default: {
      if (catEl.classList.contains('thinking')) return 'wagSitB'; // повернулся к экрану и смотрит
      if (talking) return 'meowSit';
      if (cat.state === 'busy') return 'wagSitF';
      if (t - cat.since > 2500 && cat.wantsAttention) return 'hind';
      // только что шёл или прыгал: секунду стоит, потом садится в свою позу
      if (['walk', 'jump', 'fall'].includes(cat.prev) && t - cat.since < LIFE.settle) return dirAnim('stand', d);
      return cat.idlePose;
    }
  }
}

let animName = '';
let animStart = 0;

function render(t) {
  const a = pickAnim(t);
  if (typeof a === 'string' || a.watch) {
    const name = typeof a === 'string' ? a : a.watch;
    if (name !== animName) { animName = name; animStart = t; }
    if (a.watch) { sprite.drawWatch(name, t - animStart, a.hx, a.hy); return; }
    const ended = sprite.draw(name, t - animStart);
    // одноразовая анимация (зевок) закончилась: садимся
    if (ended && cat.state === 'act') cat.act = 'sitF';
  } else {
    animName = '';
    sprite.frame(a.row, a.col);
  }
}
