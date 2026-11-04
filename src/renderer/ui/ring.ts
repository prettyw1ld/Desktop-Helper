// Рамка вокруг кнопки, на которую показывает кот, и клубок, который катится от кота к ней.
import type { Rect } from '../../shared/types';
import { dom } from '../core/dom';

const { ring } = dom;

// клубок: куда катится, когда начал и когда начал сматываться обратно
let destination: Rect | null = null;
let started = 0;
let retract: number | null = null;
// клубок рисуется по кадрам только пока виден: в покое цикл стоит и не грузит компьютер
let wake: (() => void) | null = null;

export function showRing(t: Rect | null | undefined): void {
  if (!t) { hideRing(); return; }
  const pad = 6;
  // рамку держим в пределах экрана: у развёрнутых окон края уходят за экран
  const x1 = Math.max(2, t.x - pad);
  const y1 = Math.max(2, t.y - pad);
  // рамка может лечь и на панель задач: ограничиваем всем окном, а не рабочей областью
  const x2 = Math.min(innerWidth - 2, t.x + t.w + pad);
  const y2 = Math.min(innerHeight - 2, t.y + t.h + pad);
  if (x2 - x1 < 8 || y2 - y1 < 8) { hideRing(); return; }
  Object.assign(ring.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
  ring.classList.remove('hidden');
  destination = { ...t };
  started = performance.now();
  retract = null;
  wake?.();
}

export function hideRing(): void {
  ring.classList.add('hidden');
  if (destination) retract = performance.now();
}

// ---------- Клубок ----------
export function initYarn(): void {
  const ns = 'http://www.w3.org/2000/svg';
  const route = document.createElementNS(ns, 'svg');
  route.id = 'yarn-route';
  route.setAttribute('aria-hidden', 'true');
  route.innerHTML = '<path class="route-line"/><g class="ball"><circle class="yarn-ball" r="10"/>'
    + '<path class="yarn-thread" d="M-8 -3 Q0 -9 8 2M-8 3 Q0 -3 8 6M-4 -9 Q3 0 1 9"/></g>';
  document.body.prepend(route);
  const line = route.querySelector('.route-line')!;
  const ball = route.querySelector('.ball')!;

  const animate = () => {
    if (destination) {
      const t = destination;
      const r = dom.sprite.getBoundingClientRect();
      const sx = r.left + r.width * 0.5;
      const sy = r.top + r.height * 0.66;
      const tx = Math.max(t.x, Math.min(t.x + t.w, sx));
      const ty = Math.max(t.y, Math.min(t.y + t.h, sy));
      const progress = retract === null
        ? Math.min(1, (performance.now() - started) / 480)
        : Math.max(0, 1 - (performance.now() - retract) / 250);
      const ex = sx + (tx - sx) * progress;
      const ey = sy + (ty - sy) * progress;
      route.style.display = 'block';
      line.setAttribute('d', `M${sx} ${sy} Q${(sx + ex) / 2} ${Math.min(innerHeight - 12, Math.max(sy, ey) + 30)} ${ex} ${ey}`);
      ball.setAttribute('transform', `translate(${ex} ${ey}) rotate(${progress * 140})`);
      if (retract !== null && progress === 0) { destination = null; route.style.display = 'none'; }
    } else {
      route.style.display = 'none';
      running = false;
      return;
    }
    requestAnimationFrame(animate);
  };
  let running = false;
  wake = () => { if (!running) { running = true; requestAnimationFrame(animate); } };
  wake();
}
