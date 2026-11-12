// Панели рядом с котом: «Чем помочь?», уроки, чат, напоминания, настройки.
// Каждая панель регистрирует, что делать при открытии и закрытии, поэтому этот модуль о них не знает.
import { cat, CAT_H, CAT_W, cx, H, setState, size, visTop, W } from '../cat/cat';
import { $, $$, el, isHidden } from '../core/dom';
import { T } from '../core/i18n';
import { rand } from '../core/util';
import { guide, trainer } from '../guide/state';
import { hideBubble } from './bubble';
import { icon } from './icons';

export type PanelName = 'help' | 'lessons' | 'chat' | 'reminders' | 'settings' | 'report';
export const PANELS: PanelName[] = ['help', 'lessons', 'chat', 'reminders', 'settings', 'report'];
export const isPanel = (s: string): s is PanelName => (PANELS as string[]).includes(s);

interface PanelHooks { show?: () => void; close?: () => void }
const hooks: Partial<Record<PanelName, PanelHooks>> = {};
const closeHooks: (() => void)[] = [];

/** Что сделать, когда панель открывают или закрывают. */
export function registerPanel(name: PanelName, h: PanelHooks): void { hooks[name] = h; }
/** Что сделать при закрытии любой панели (например, остановить запись голоса). */
export function onPanelsClose(fn: () => void): void { closeHooks.push(fn); }

let open: PanelName | null = null;
export const openPanel = (): PanelName | null => open;

const panelEl = (name: PanelName): HTMLElement => $(`#panel-${name}`);

// «Назад» возвращает в окно, из которого пришли (по умолчанию в главное), а не только закрывает всё крестиком.
const cameFrom: Partial<Record<PanelName, PanelName>> = {};

function goBack(): void {
  const to = (open && cameFrom[open]) || 'help';
  closePanels();
  showPanel(to);
}

function addBackButtons(): void {
  for (const p of $$('.panel')) {
    const h = p.querySelector(':scope > header');
    if (!h || p.id === 'panel-help' || h.querySelector('.back')) continue;
    const b = el('button', 'icon back');
    b.type = 'button';
    b.title = T('back');
    b.setAttribute('aria-label', T('back'));
    b.innerHTML = icon('back');
    b.addEventListener('click', (e) => { e.stopPropagation(); goBack(); });
    h.prepend(b);
  }
}

export function showPanel(name: PanelName): void {
  addBackButtons();
  if (name !== open) cameFrom[name] = open && open !== name ? open : 'help';
  for (const p of $$('.panel')) p.classList.add('hidden');
  // случайная фраза кота («Привет!») не должна лежать поверх окна
  if (!guide.active && !trainer.step) hideBubble();
  const panel = panelEl(name);
  panel.classList.remove('hidden');
  open = name;
  if (!['act', 'fall', 'drag', 'jump', 'perch'].includes(cat.state)) setState('busy');
  hooks[name]?.show?.();
  placePanel(panel);
}

export function closePanels(): void {
  if (open) hooks[open]?.close?.();
  for (const p of $$('.panel')) p.classList.add('hidden');
  open = null;
  for (const fn of closeHooks) fn();
  if (cat.state === 'busy' && !guide.active && !trainer.step) setState('idle', rand(1500, 4000));
}

/** Панель над котом, а если сверху не влезает — сбоку. */
export function placePanel(panel: HTMLElement): void {
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const top0 = visTop() + 30 * size();
  let left = cx() - pw / 2;
  let top = top0 - ph - 16;
  if (top < 8) {
    top = Math.max(8, Math.min(H() - ph - 8, cat.y + CAT_H - ph));
    const half = (CAT_W * size()) / 2;
    left = cx() + half + 14 + pw < W() ? cx() + half + 14 : cx() - half - pw - 14;
  }
  panel.style.left = `${Math.max(8, Math.min(W() - pw - 8, left))}px`;
  panel.style.top = `${Math.max(8, Math.min(H() - ph - 12, top))}px`;
}

/** Перенести открытую панель, если кот или размер окон изменились. */
export function relayoutPanel(): void {
  if (!open) return;
  const panel = panelEl(open);
  if (!isHidden(panel)) placePanel(panel);
}

export function initPanels(): void {
  for (const b of $$('[data-close]')) b.addEventListener('click', closePanels);
  // Разворачивающиеся панели (списки, ответы чата) держим в пределах экрана.
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; relayoutPanel(); });
  };
  const observer = new ResizeObserver(schedule);
  for (const p of $$('.panel')) observer.observe(p);
  document.addEventListener('toggle', (e) => { if ((e.target as Element).closest?.('.panel')) schedule(); }, true);
  window.addEventListener('resize', schedule);
}
