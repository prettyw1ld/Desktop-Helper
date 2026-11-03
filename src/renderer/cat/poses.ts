// Позы, сердечки и звёздочки: кот радуется, удивляется, мурчит.
import { dom, el } from '../core/dom';
import { T } from '../core/i18n';
import { Sound } from '../core/sound';
import { pick, rand } from '../core/util';
import { say } from '../ui/bubble';
import { cat, setState } from './cat';
import { ANIM, dirAnim, type AnimName } from './sprites';

// Позы с понятными именами для остального кода.
export type PoseName = AnimName | 'happy' | 'wave' | 'coffee' | 'angry' | 'headpat' | 'blush';
const POSE_ALIAS: Partial<Record<PoseName, AnimName>> = {
  happy: 'hind', wave: 'meowStand', coffee: 'eatF', headpat: 'meowSit', blush: 'lickSit',
};

/** Поза на ms миллисекунд, с репликой text. */
export function showPose(name: PoseName, ms = 4000, text = ''): void {
  const a = name === 'angry' ? dirAnim('hiss', cat.dir) : POSE_ALIAS[name] ?? name;
  cat.act = a in ANIM ? a as AnimName : 'sitF';
  setState('act', ms);
  if (text) say(text, ms);
}

/** Значок, который всплывает над котом и тает. kind: h — сердечко или звёздочка. */
export function spawnFx(kind: string, ch: string): void {
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
  for (let i = 0; i < 8; i++) setTimeout(() => spawnFx('h', pick(['⭐', '🎉', '💛', '✨'])), i * 140);
  setTimeout(() => Sound.purr(1.5), 500);
}

export function pet(): void {
  showPose(pick<AnimName>(['heartsSitF', 'heartsSitF', 'hind', 'meowSit']), 2500);
  cat.wantsAttention = false;
  for (let i = 0; i < 5; i++) setTimeout(() => spawnFx('h', pick(['💛', '🤍', '💛'])), i * 150);
  say(T('say.pet'), 2500);
  Sound.purr(2.4);
  cat.lastPet = Date.now();
}
