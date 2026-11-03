// Какую анимацию показывать в каждый момент, и сама отрисовка спрайта.
import { dom } from '../core/dom';
import { cat } from './cat';
import { watchingCursor, watchPose } from './cursor-watch';
import { ANIM, CatSprite, dirAnim, type AnimName, type Frame } from './sprites';

const SHEETS = '../../assets/cats/';
const sprite = new CatSprite(dom.sprite);

let animName: AnimName | '' = '';
let animStart = 0;

export function setCatColor(color: string): void { sprite.setColor(color, SHEETS); }

const thinking = () => dom.cat.classList.contains('thinking');

/** Имя анимации или конкретный кадр. */
export function pickAnim(t: number): AnimName | Frame {
  const d = cat.dir;
  if (dom.cat.classList.contains('happy')) return cat.happyAnim;
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
      return cat.sleepKind;
    }
    case 'drag': return 'scruffF';
    case 'fall': return cat.vy < 0 ? { row: ANIM.jumpB.row, col: 1 } : { row: ANIM[dirAnim('jump', d)].row, col: 2 };
    case 'jump': {
      const j = cat.jump;
      if (!j) return 'sitF';
      const p = (t - j.t0) / 1000 / j.dur;
      if (j.vertical) return { row: ANIM.jumpB.row, col: p < 0.5 ? 1 : 2 };
      return { row: ANIM[dirAnim('jump', d)].row, col: p < 0.12 ? 1 : p < 0.85 ? 2 : 3 };
    }
    case 'act': return cat.act;
    case 'perch': {
      if (thinking()) return 'wagStandB';
      if (talking) return 'meowStand';
      // показываем лапкой на кнопку, потом немного ждём, виляя хвостом
      const e = (t - cat.since) % 3600;
      return e < 1800 ? dirAnim('swipeStand', d) : dirAnim('wagStand', d);
    }
    default: {
      if (thinking()) return 'thinkB'; // повернулся к экрану и думает «…»
      if (talking) return 'meowSit';
      if (cat.state === 'busy') return 'wagBlinkSitF';
      if (watchingCursor(t)) return watchPose(t);
      if (t - cat.since > 2500 && cat.wantsAttention) return 'hind';
      return t - cat.since > 2000 ? cat.idlePose : dirAnim('wagStand', d);
    }
  }
}

export function renderCat(t: number): void {
  const a = pickAnim(t);
  if (typeof a !== 'string') {
    animName = '';
    sprite.frame(a.row, a.col);
    return;
  }
  if (a !== animName) {
    animName = a;
    animStart = t;
    // точки «…» уже нарисованы в кадре thinkB: CSS-точки не нужны
    dom.cat.classList.toggle('sprite-dots', a === 'thinkB');
  }
  const ended = sprite.draw(a, t - animStart);
  // одноразовая анимация (зевок, «!») закончилась: садимся
  if (ended && cat.state === 'act') cat.act = 'sitF';
}
