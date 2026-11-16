// Какую анимацию показывать в каждый момент, и сама отрисовка спрайта.
import { dom } from '../core/dom';
import { cat, GET_UP_MS } from './cat';
import { LIFE } from './pacing';
import { watchingCursor, watchPose } from './cursor-watch';
import { ANIM, CatSprite, dirAnim, type AnimName, type Frame, type HeadTurn } from './sprites';
import { carryFacing, swing } from './swing';

const SHEETS = '../../assets/cats/';
const sprite = new CatSprite(dom.sprite);

let animName: AnimName | '' = '';
let animStart = 0;

export function setCatColor(color: string): void { sprite.setColor(color, SHEETS); }

/** Кот нужного окраса в кнопке настроек: сидит лицом к нам, как на экране. */
export function drawCatPic(canvas: HTMLCanvasElement, color: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    // кот занимает малую часть клетки 64×64: берём только его и увеличиваем, чтобы окрас было видно
    const tmp = document.createElement('canvas');
    tmp.width = 64;
    tmp.height = 64;
    const t = tmp.getContext('2d');
    if (!t) return;
    t.drawImage(img, 0, 0, 64, 64, 0, 0, 64, 64);
    const px = t.getImageData(0, 0, 64, 64).data;
    let x0 = 64, y0 = 64, x1 = -1, y1 = -1;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (px[(y * 64 + x) * 4 + 3]! < 20) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = 63; y1 = 63; }
    const side = Math.max(x1 - x0, y1 - y0) + 3;
    const cx = (x0 + x1 + 1) / 2;
    const cy = (y0 + y1 + 1) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side, 0, 0, canvas.width, canvas.height);
  };
  img.src = `${SHEETS}${color}.png`;
}

const MOVING: string[] = ['walk', 'jump', 'fall', 'drag', 'trash', 'intro', 'outro'];

const thinking = () => dom.cat.classList.contains('thinking');

/** Имя анимации, конкретный кадр или поза спиной с повёрнутой головой. */
export function pickAnim(t: number): AnimName | Frame | HeadTurn {
  const d = cat.dir;
  // радость (прыжок на месте, стойка) — только когда кот стоит на месте: не в полёте, не на ходу и не за шкирку
  if (dom.cat.classList.contains('happy') && !MOVING.includes(cat.state)) return cat.happyAnim;
  if (cat.lookUntil && t < cat.lookUntil) return cat.lookPose;
  const talking = t < cat.meowUntil;
  switch (cat.state) {
    case 'walk':
      // вставал из лёжа: сначала садится, потом встаёт, и только потом идёт
      if (t < cat.getUpUntil) return dirAnim(cat.getUpUntil - t > GET_UP_MS / 2 ? 'sit' : 'stand', d);
      return dirAnim(cat.running ? 'run' : 'walk', d);
    case 'intro': return cat.introRun ? 'runDown' : 'walkDown';
    case 'outro': return 'walkUp';
    case 'sleep': {
      // сидел или стоял: зевает, ложится и засыпает; уже лежал — сразу устраивается спать
      const e = t - cat.since + (cat.sleepFromLying ? 1200 : 0);
      if (e < 1200) return 'yawn';
      if (e < 2400) return d < 0 ? 'lieF_L' : 'lieF_R';
      return cat.sleepKind;
    }
    case 'drag': { // несут быстро — боком, мордой вперёд; медленно или стоят — анфас
      const f = carryFacing(swing, t);
      return f > 0 ? 'carryR' : f < 0 ? 'carryL' : 'carryF';
    }
    case 'trash':   // в Корзину уходит спиной к нам, из неё выпрыгивает, как в прыжке
    case 'fall': if (cat.state === 'trash' && cat.trashIn) return 'carryB';
      return cat.vy < 0 ? { row: ANIM.jumpB.row, col: 1 } : { row: ANIM[dirAnim('jump', d)].row, col: 2 };
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
      // только что шёл или прыгал: секунду стоит, потом садится в свою позу
      if (['walk', 'jump', 'fall'].includes(cat.prev) && t - cat.since < LIFE.settle) return dirAnim('stand', d);
      return cat.idlePose;
    }
  }
}

export function renderCat(t: number): void {
  const a = pickAnim(t);
  cat.pose = typeof a === 'string' ? a : 'gaze' in a ? 'wagSitF' : '';
  if (typeof a !== 'string' && 'gaze' in a) {
    // смотрит на курсор: хвост виляет как в wagSitF, голова повёрнута к мышке
    if (animName !== 'wagSitF') {
      animName = 'wagSitF';
      animStart = t;
      dom.cat.classList.remove('sprite-dots');
    }
    sprite.drawLook(t - animStart, a);
    return;
  }
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
