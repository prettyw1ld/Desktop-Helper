// Жизнь кота: главный цикл, физика, решения «что делать дальше», когда ему скучно.
import { dom } from '../core/dom';
import { T } from '../core/i18n';
import { settings } from '../core/settings';
import { clamp, now, pick, rand } from '../core/util';
import { busyWithPerson, trainer } from '../guide/state';
import { bubbleShown, placeBubble, say } from '../ui/bubble';
import { openPanel } from '../ui/panels';
import { cat, CAT_H, CAT_W, cx, floorY, G, inAir, jumpTo, setState, size, startFall, W, walkTo } from './cat';
import { mouseMoving, startCursorWatch, updateCursorWatch } from './cursor-watch';
import { between, LIFE } from './pacing';
import { allPlatforms, currentPlat, groundY } from './platforms';
import { showPose } from './poses';
import { renderCat } from './render';
import { dirAnim, type AnimName } from './sprites';

// Чем кот занимается сам, когда ему скучно. Все анимации из листа.
interface Act { anim: () => AnimName; text?: string; ms?: number }
const ACTS: Act[] = [
  { anim: () => 'lickSit', text: 'act.grooming' },
  { anim: () => 'lickLie', text: 'act.grooming' },
  { anim: () => dirAnim('scratch', cat.dir) },
  { anim: () => 'yawn', text: 'act.yawn', ms: 1400 },
  { anim: () => pick<AnimName>(['eatF', 'eatB', dirAnim('eat', cat.dir)]), text: 'act.eating' },
  { anim: () => dirAnim('wagLie', cat.dir), text: 'act.rolling' },
  { anim: () => pick<AnimName>(['swipeSitF', 'swipeSitF2', dirAnim('swipeSit', cat.dir), `${dirAnim('swipeSit', cat.dir)}2`]), text: 'act.playing' },
  { anim: () => pick<AnimName>([dirAnim('swipeStand', cat.dir), `${dirAnim('swipeStand', cat.dir)}2`, 'swipeStandF', 'swipeStandF2']), text: 'act.tailChasing' },
  { anim: () => pick<AnimName>(['swipeSitB', 'swipeStandB']), text: 'act.knocking' },
  { anim: () => 'hind', text: 'act.birdWatching' },
  { anim: () => 'meowLie' },
  { anim: () => pick<AnimName>(['lieL', 'lieR', 'blinkLieL', 'blinkLieR']) },
  { anim: () => 'hopF', ms: 1800 },
];

export function goSleep(ms: number): void {
  const kind = pick(['sleep1', 'sleep2', 'sleep3', 'sleep4', 'sleep5', 'sleepBack'] as const);
  cat.sleepKind = dirAnim(`${kind}Z`, cat.dir); // со Zzz над головой
  setState('sleep', ms);
}

// Залезть на окно: подойти сбоку и запрыгнуть.
function climbSomewhere(): boolean {
  const platforms = allPlatforms();
  if (!platforms.length) return false;
  const target = pick(platforms);
  const land = rand(target.x1 + 40, target.x2 - 40);
  const side = cx() < land ? -1 : 1;
  const from = clamp(land + side * rand(80, 160), CAT_W / 2, W() - CAT_W / 2);
  cat.climb = { id: target.id, cx: land };
  walkTo(from, Math.abs(from - cx()) > 450);
  const s = T('say.climb');
  if (s && Math.random() < 0.5) say(s, 2000);
  return true;
}

function wander(): void {
  const p = currentPlat();
  if (p) {
    const off = Math.random() < 0.2; // иногда спрыгивает с окна
    walkTo(off ? pick([p.x1 - 70, p.x2 + 70]) : rand(p.x1 + 25, p.x2 - 25));
    return;
  }
  let goal = rand(20 + CAT_W / 2, W() - CAT_W / 2 - 20);
  if (Math.abs(goal - cx()) < 60) goal = cx() > W() / 2 ? cx() - 200 : cx() + 200;
  walkTo(goal, Math.abs(goal - cx()) > 450 && Math.random() < 0.4);
}

// Чем заняться дальше: вероятности, в сумме 1. Мышка недавно двигалась: кот охотнее за ней следит.
type Choice = 'climb' | 'walk' | 'idle' | 'watch' | 'sleep' | 'act';
const CHOICES: Record<Choice, number> = { climb: 0.08, walk: 0.26, idle: 0.36, watch: 0.06, sleep: 0.08, act: 0.16 };
const CHOICES_MOUSE: Record<Choice, number> = { climb: 0.07, walk: 0.22, idle: 0.25, watch: 0.28, sleep: 0.04, act: 0.14 };
let lastChoice: Choice | null = null;

function roll(weights: Record<Choice, number>): Choice {
  let r = Math.random();
  for (const [k, w] of Object.entries(weights) as [Choice, number][]) { r -= w; if (r < 0) return k; }
  return 'idle';
}

export function decideNext(): void {
  if (busyWithPerson()) { setState(cat.state === 'perch' ? 'perch' : 'busy'); return; }
  if (openPanel()) { setState('busy'); return; }
  const weights = mouseMoving(4000) ? CHOICES_MOUSE : CHOICES;
  let choice = roll(weights);
  // одно и то же занятие два раза подряд выглядит суетливо: перебрасываем один раз
  if (choice === lastChoice && choice !== 'idle') choice = roll(weights);
  lastChoice = choice;
  switch (choice) {
    case 'climb':
      if (!currentPlat() && settings.windows && climbSomewhere()) return;
      return wander();
    case 'walk': return wander();
    case 'watch': return startCursorWatch();
    case 'sleep': return goSleep(between(LIFE.sleep));
    case 'act': {
      const a = pick(ACTS);
      return showPose(a.anim(), a.ms || between(LIFE.act), a.text && Math.random() < 0.5 ? T(a.text) : '');
    }
    default: return setState('idle', between(LIFE.idle));
  }
}

// ---------- Приземление ----------
let onTrainerLanding: () => void = () => {};
/** Тренажёр мыши ждёт, когда кот приземлится после переноса. */
export function setTrainerLanding(fn: () => void): void { onTrainerLanding = fn; }

function land(): void {
  if (cat.afterLand) {
    const f = cat.afterLand;
    cat.afterLand = null;
    setState('idle', rand(1500, 3000));
    f();
    return;
  }
  if (trainer.step === 'landing') { onTrainerLanding(); return; }
  setState('idle', between(LIFE.afterLand));
  if (Math.random() < 0.5) say(T('say.land'), 2200);
}

// ---------- Главный цикл ----------
const frameHooks: (() => void)[] = [];
/** Что обновлять каждый кадр (например, таймер фокуса над котом). */
export function onFrame(fn: () => void): void { frameHooks.push(fn); }

let last = now();

function step(t: number, dt: number): void {
  switch (cat.state) {
    case 'walk': {
      const speed = (cat.running ? 190 : 75) * (settings.speed || 1);
      cat.x += cat.dir * speed * dt;
      if ((cat.dir > 0 && cat.x >= cat.targetX) || (cat.dir < 0 && cat.x <= cat.targetX)) {
        cat.x = cat.targetX;
        const { climb, onArrive } = cat;
        cat.climb = null;
        const target = climb && allPlatforms().find((p) => p.id === climb.id && climb.cx >= p.x1 && climb.cx <= p.x2);
        if (onArrive) { cat.onArrive = null; onArrive(); } else if (target && climb) jumpTo(climb.cx, target.y - CAT_H, target.id);
        else setState('idle', between(LIFE.afterWalk));
      }
      break;
    }
    case 'jump': {
      const j = cat.jump;
      if (!j) { startFall(); break; }
      const e = (t - j.t0) / 1000;
      if (e < j.dur) {
        cat.x = j.x0 + j.vx * e;
        cat.y = j.y0 + j.vy * e + 0.5 * G * e * e;
        break;
      }
      cat.x = j.tx;
      cat.y = j.ty;
      cat.plat = j.plat;
      if (j.plat && !currentPlat()) { startFall(); break; }
      const after = j.after;
      j.after = null; // только один раз, даже если внутри что-то упадёт
      setState('idle', between(LIFE.afterLand));
      after?.();
      break;
    }
    case 'fall': {
      const prevBottom = cat.y + CAT_H;
      cat.vy += G * dt;
      cat.y += cat.vy * dt;
      let floor = floorY();
      let landOn: number | null = null;
      if (cat.vy > 0) {
        for (const p of allPlatforms()) {
          if (cx() < p.x1 + 10 || cx() > p.x2 - 10) continue;
          if (prevBottom <= p.y + 1 && cat.y + CAT_H >= p.y && p.y - CAT_H < floor) { floor = p.y - CAT_H; landOn = p.id; }
        }
      }
      if (cat.y >= floor) {
        cat.y = floor;
        cat.plat = landOn;
        if (cat.vy > 500) cat.vy = -cat.vy * 0.3; // отскок
        else { cat.vy = 0; land(); }
      }
      break;
    }
    case 'intro':
    case 'outro': {
      const p = clamp((t - cat.since) / 1600, 0, 1);
      const s = cat.state === 'intro' ? 0.3 + 0.7 * p : 1 - 0.75 * p;
      dom.cat.style.setProperty('--s', s.toFixed(3));
      if (p >= 1) {
        dom.cat.style.setProperty('--s', '1');
        const done = cat.onDone;
        cat.onDone = null;
        setState('idle', rand(2000, 4000));
        done?.();
      }
      break;
    }
    default:
      break;
  }
}

function tickFrame(): void {
  const t = now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;

  // окно под котом закрыли или сдвинули: падаем
  if (cat.plat && !inAir()) {
    const p = currentPlat();
    if (!p) startFall();
    else cat.y = p.y - CAT_H;
  }

  step(t, dt);
  if (cat.plat && cat.state === 'walk' && !currentPlat()) startFall();
  updateCursorWatch(t);

  if (t > cat.until) {
    if (cat.state === 'sleep') { say(T('say.wake'), 2500); showPose('yawn', 1400); } else decideNext();
  }

  renderCat(t);

  const pad = (CAT_W * (1 - size())) / 2;
  cat.x = clamp(cat.x, -pad, W() - CAT_W + pad);
  if (!inAir()) cat.y = Math.min(cat.y, groundY());
  dom.cat.style.transform = `translate(${Math.round(cat.x)}px, ${Math.round(cat.y)}px)`;
  for (const fn of frameHooks) fn();
}

// Одна ошибка в кадре не должна останавливать кота: иначе он замирает посреди прыжка, а облачко не появляется.
// Кот пиксельный: 30 кадров в секунду ему хватает. Прозрачное окно на весь экран дорого перерисовывать,
// и на слабых компьютерах 60 кадров давали подтормаживания всего рабочего стола.
const FRAME_MS = 1000 / 30 - 2;
let lastFrame = 0;

function tick(): void {
  const t = now();
  if (t - lastFrame < FRAME_MS) { requestAnimationFrame(tick); return; }
  lastFrame = t;
  if (bubbleShown()) { try { placeBubble(); } catch { /* пусто */ } }
  try { tickFrame(); } catch (err) { console.error('tick', err); }
  requestAnimationFrame(tick);
}

export function startLoop(): void {
  last = now();
  requestAnimationFrame(tick);
}
