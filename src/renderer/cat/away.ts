// Человек отошёл от компьютера: 5 минут никто не трогал мышь и клавиатуру. Кот не играет сам с собой,
// а засыпает и спит, пока человек не вернётся; тогда просыпается и зевает.
import { api } from '../core/api';
import { T } from '../core/i18n';
import { busyWithPerson } from '../guide/state';
import { bubbleShown, say } from '../ui/bubble';
import { openPanel } from '../ui/panels';
import { goSleep } from './behaviour';
import { cat, type CatState } from './cat';
import { LIFE } from './pacing';
import { showPose } from './poses';

const CHECK_MS = 2000;
// из этих занятий кота можно уложить спать; если его несут, он падает, в корзине или ведёт урок — не трогаем
const CALM: CatState[] = ['idle', 'act', 'walk'];

let away = false;
let napping = false; // кот спит, потому что человек отошёл

/** Человек не трогал мышь и клавиатуру дольше LIFE.away. */
export const userAway = (): boolean => away;

async function check(): Promise<void> {
  let sec: number | null = null;
  try { sec = await api.getIdleSec(); } catch { /* не узнали — считаем, что человек рядом */ }
  away = sec !== null && sec * 1000 >= LIFE.away;
  if (away) {
    if (cat.state === 'sleep') { cat.until = Infinity; napping = true; return; } // уже спит: спит дальше
    if (!CALM.includes(cat.state) || busyWithPerson() || openPanel() || bubbleShown()) return;
    cat.climb = null;
    goSleep();
    napping = true;
    return;
  }
  if (!napping) return;
  napping = false;
  if (cat.state === 'sleep') { say(T('say.wake'), 2500); showPose('yawn', 1400); }
}

export function initAwayWatch(): void {
  setInterval(() => { void check(); }, CHECK_MS);
}
