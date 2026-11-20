// Позы, сердечки и звёздочки: кот радуется, удивляется, мурчит.
import { dom, el } from '../core/dom';
import { T } from '../core/i18n';
import { Sound } from '../core/sound';
import { pick, rand } from '../core/util';
import { say } from '../ui/bubble';
import { cat, setState } from './cat';
import { ANIM, dirAnim, type AnimName } from './sprites';

// Позы с понятными именами для остального кода.
type PoseName = AnimName | 'happy' | 'wave' | 'coffee' | 'angry' | 'loaf' | 'headpat' | 'blush';
const POSE_ALIAS: Partial<Record<PoseName, AnimName>> = {
  happy: 'hind', wave: 'meowStand', coffee: 'eatF', headpat: 'meowSit', blush: 'lickSit',
};

/** Поза на ms миллисекунд, с репликой text. */
export function showPose(name: PoseName, ms = 4000, text = ''): void {
  // злится — шипит боком; батон — ложится мордой к нам, лапки поджаты, моргает
  const a = name === 'angry' ? dirAnim('hiss', cat.dir) : name === 'loaf' ? dirAnim('blinkLie', cat.dir) : POSE_ALIAS[name] ?? name;
  cat.act = a in ANIM ? a as AnimName : 'sitF';
  setState('act', ms);
  if (text) say(text, ms);
}

/** Значок, который всплывает над котом и тает. kind: h — звёздочка и т.п., heart — розовое пиксельное сердечко. */
function spawnFx(kind: string, ch = ''): void {
  const s = el('span', kind, ch);
  s.style.left = `${75 + rand(-20, 20)}px`;
  s.style.top = `${rand(10, 30)}px`;
  s.style.setProperty('--dx', `${rand(-25, 25)}px`);
  dom.fx.append(s);
  setTimeout(() => s.remove(), 1700);
}

/** Кот вздрагивает с «!», потом then() (если за это время его ничем не заняли). */
export function surprised(then: () => void): void {
  showPose('surpriseF', 900);
  const since = cat.since;
  setTimeout(() => { if (cat.state === 'act' && cat.since === since) then(); }, 900);
}

export function happy(ms = 1200): void {
  cat.happyAnim = pick<AnimName>(['hind', 'hopF']);
  dom.cat.classList.add('happy');
  setTimeout(() => dom.cat.classList.remove('happy'), ms);
}

export function celebrate(): void {
  happy(1800);
  for (let i = 0; i < 8; i++) setTimeout(() => (i % 4 === 2 ? spawnFx('heart') : spawnFx('h', pick(['⭐', '🎉', '✨']))), i * 140);
  setTimeout(() => Sound.purr(1.5), 500);
}

/** Кота ткнули левой кнопкой: он то злится и шипит, то ложится батоном мордой к нам. */
export function poked(): void {
  cat.watchUntil = 0;
  if (Math.random() < 0.5) {
    showPose('angry', 2200, T('say.angry'));
    Sound.hiss();
  } else {
    showPose('loaf', 4500);
    Sound.purr(1.2);
  }
}

/** Розовые сердечки, как нарисованные в кадре heartsSitF (кот радуется, что его гладят). */
function hearts(n = 5, every = 150): void {
  for (let i = 0; i < n; i++) setTimeout(() => spawnFx('heart'), i * every);
}

/** Кота погладили: двойным кликом или мышкой (stroke — водят по нему, тогда он жмурится с сердечками). */
export function pet(stroke = false): void {
  cat.watchUntil = 0;
  // поза чуть дольше паузы между радостями (STROKE.repeatMs), чтобы, пока гладят, кот не вставал
  showPose(stroke ? 'heartsSitF' : pick<AnimName>(['heartsSitF', 'heartsSitF', 'hind', 'meowSit']), stroke ? 3000 : 2500);
  cat.wantsAttention = false;
  hearts();
  say(T('say.pet'), 2500);
  Sound.purr(2.4);
  cat.lastPet = Date.now();
}

/** Кота продолжают гладить: держит позу, мурчит дальше, ещё пара сердечек, без новых реплик. */
export function petMore(): void {
  cat.watchUntil = 0;
  showPose('heartsSitF', 3000);
  hearts(3, 200);
  Sound.purr(2.5); // чуть короче паузы между радостями: следующая подхватит мурчание
  cat.lastPet = Date.now();
}
