// Облачко над котом: реплики, подсказки и кнопки под ними.
import { cat, CAT_H, CAT_W, H, size, W } from '../cat/cat';
import { dom, el, isHidden } from '../core/dom';
import { clamp, now, timer } from '../core/util';
import { guide } from '../guide/state';
import { pickSpot, targetZones, type Zone } from './bubble-spot';
import { ringBox } from './ring';

/** Кнопка в облачке: [надпись, действие, главная?]. */
export type Action = [label: string, run: () => void, primary?: boolean];

export interface SayOptions {
  actions?: Action[];
  items?: Action[];    // пункты списка (например, открытого меню): кнопки поменьше, каждая на своей строке
  guide?: boolean;     // это подсказка: её не перебивают случайные фразы
  danger?: boolean;
  explain?: string;    // мелкий текст под репликой
  step?: string;       // «Шаг 2 из 5» над репликой
}

const { bubble, bubbleText, bubbleActions } = dom;
const hideTimer = timer();

// что облачку подсказки закрывать нельзя, кроме кнопки в рамке (например, открывшееся меню)
let avoid: Zone[] = [];
export function setBubbleAvoid(zones: Zone[]): void { avoid = zones; }

/** Сказать text и убрать облачко через ms (Infinity — пока не уберут). */
export function say(text: string, ms = 4000, opts: SayOptions = {}): void {
  if (!text) return;
  // пока кот ведёт по шагам, случайные фразы («Оп! Приземлился») не закрывают подсказку
  if (guide.active && !opts.guide && ms <= 4500) return;
  bubbleText.textContent = text;
  if (opts.step) bubbleText.prepend(el('div', 'step-no', opts.step));
  if (opts.explain) bubbleText.append(el('div', 'explain', opts.explain));
  bubbleActions.replaceChildren();
  for (const [label, run] of opts.items ?? []) {
    const b = el('button', 'item', label);
    b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
    bubbleActions.append(b);
  }
  for (const [label, run, primary] of opts.actions ?? []) {
    const b = el('button', primary ? 'primary' : '', label);
    b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
    bubbleActions.append(b);
  }
  bubble.classList.toggle('guide', !!(opts.guide || opts.actions || opts.items));
  bubble.classList.toggle('danger', !!opts.danger);
  bubble.classList.remove('hidden', 'below');
  bubble.scrollTop = 0;
  cat.meowUntil = now() + 800;
  placeBubble();
  if (Number.isFinite(ms)) hideTimer.set(hideBubble, ms); else hideTimer.clear();
}

export function hideBubble(): void {
  hideTimer.clear();
  bubble.classList.add('hidden');
  bubbleActions.replaceChildren();
}

export const bubbleShown = (): boolean => !isHidden(bubble);

// Общая логика для Mac и Windows: координаты уже в DIP окна Пушика.
// Пересчитываем сторону облачка при движении, иначе «снизу» остаётся после прыжка вниз.
// offsetHeight не учитывает анимацию появления. Если места мало — ограничиваем экраном.
// Границы переноса между ОС описаны в docs/guide-porting.md.
export function placeBubble(): void {
  const width = bubble.offsetWidth;
  const height = bubble.offsetHeight;
  const above = cat.y + CAT_H - 128 * size() - height;
  const belowTop = cat.y + CAT_H + 14;
  const below = above < 8 && belowTop + height <= H() - 8;
  bubble.classList.toggle('below', below);
  const top = below ? belowTop : above;
  const left = cat.x + CAT_W / 2 - width / 2;
  let dx = clamp(left, 8, Math.max(8, W() - width - 8)) - left;
  let dy = clamp(top, 8, Math.max(8, H() - height - 8)) - top;
  // подсказка: облачко не должно закрывать кнопку в рамке, место под её меню и то, что уже открылось
  const target = bubble.classList.contains('guide') ? ringBox() : null;
  const zones = bubble.classList.contains('guide') ? [...avoid, ...(target ? targetZones(target, H()) : [])] : [];
  if (zones.length) {
    const s = dom.sprite.getBoundingClientRect();
    const body = { x: s.left, y: s.top, w: s.width, h: s.height };
    const spot = pickSpot({ box: { w: width, h: height }, preferred: { x: left + dx, y: top + dy }, body, zones, screen: { w: W(), h: H() } });
    dx = spot.x - left;
    dy = spot.y - top;
  }
  bubble.style.marginLeft = '0px';
  bubble.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  bubble.classList.toggle('detached', Math.abs(dy) > 1 || Math.abs(dx) > width / 2);
}
