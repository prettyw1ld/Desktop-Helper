// Домик освоенных навыков: комната, где каждый освоенный навык — предмет на полке.
import type { Skill } from '../../shared/types';
import { api } from '../core/api';
import { $, el } from '../core/dom';
import { settings } from '../core/settings';
import { routeGoal } from '../guide/router';
import { lessons } from '../panels/lessons';
import { closePanels, showPanel } from '../ui/panels';
import { closePostcard, postcardOpen, showPostcard } from './postcard';

let home: HTMLElement | null = null;
let roomObserver: ResizeObserver | null = null;

function closeHome(): void {
  roomObserver?.disconnect();
  roomObserver = null;
  home?.remove();
  home = null;
}

/** Заголовок окна с крестиком. */
export function header(container: HTMLElement, title: string, close: () => void): void {
  const h = el('header');
  const b = el('button', 'home-close', '×');
  b.setAttribute('aria-label', 'Закрыть');
  b.onclick = close;
  h.append(el('h2', '', title), b);
  container.append(h);
}

type ObjectKind = 'photos' | 'call' | 'search' | 'mouse' | 'type' | 'volume';

// Какой предмет в комнате означает навык.
function objectFor(name: string): [ObjectKind, string] {
  if (/фото|photo/i.test(name)) return ['photos', 'Рамка с фотографией'];
  if (/звон|call/i.test(name)) return ['call', 'Телефон'];
  if (/интернет|поиск|search/i.test(name)) return ['search', 'Лупа исследователя'];
  if (/мыш|mouse/i.test(name)) return ['mouse', 'Игрушечная мышка'];
  if (/букв|текст|клавиат|text/i.test(name)) return ['type', 'Печатная машинка'];
  if (/звук|громк|sound/i.test(name)) return ['volume', 'Радио'];
  return ['search', 'Лупа исследователя'];
}

interface Group { title: string; skills: Skill[] }

const ROOM_DECOR = '<div class="room-window"><i></i><i></i><i></i><i></i></div><div class="room-shelf room-shelf-top"></div>'
  + '<div class="room-shelf room-shelf-middle"></div><div class="room-floor"></div><div class="room-rug"></div>'
  + '<div class="room-desk"><i></i><i></i></div><div class="room-plant"><i></i><i></i><i></i><b></b></div>'
  + '<div class="room-sleeping-cat"></div><div class="room-sunlight"></div>';

function openHome(): void {
  closeHome();
  closePanels();
  const h = el('section', 'skill-home hit');
  h.setAttribute('role', 'dialog');
  h.setAttribute('aria-label', 'Домик освоенных навыков');
  header(h, 'Домик Пушика', closeHome);
  const back = el('button', 'home-close home-back', '←');
  back.setAttribute('aria-label', 'Назад');
  back.title = 'Назад';
  back.onclick = () => { closeHome(); showPanel('lessons'); };
  h.querySelector('header')?.prepend(back);
  h.append(el('p', '', 'Каждый предмет — твоё открытие. Нажми, чтобы вспомнить навык.'));

  const room = el('div', 'home-room');
  const detail = el('div', 'home-detail');
  detail.setAttribute('aria-live', 'polite');
  const decor = el('div', 'room-decor');
  decor.setAttribute('aria-hidden', 'true');
  decor.innerHTML = ROOM_DECOR;
  room.append(decor);
  const tooltip = el('div', 'room-tooltip hidden');
  tooltip.setAttribute('role', 'tooltip');
  room.append(tooltip);

  // Подпись над предметом, в пределах комнаты
  let pointed: HTMLElement | null = null;
  const positionLabel = () => {
    if (!pointed || tooltip.classList.contains('hidden')) return;
    const box = pointed.getBoundingClientRect();
    const bounds = room.getBoundingClientRect();
    const pad = 10;
    const w = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const cx = box.left - bounds.left - room.clientLeft + box.width / 2;
    const top = box.top - bounds.top - room.clientTop;
    const y = top - th - 7 >= pad ? top - th - 7 : top + box.height + 6;
    tooltip.style.left = `${Math.max(pad, Math.min(room.clientWidth - w - pad, cx - w / 2))}px`;
    tooltip.style.top = `${Math.max(pad, Math.min(room.clientHeight - th - pad, y))}px`;
  };
  const labelFor = (button: HTMLElement, title: string) => {
    pointed = button;
    tooltip.textContent = title;
    tooltip.classList.remove('hidden');
    positionLabel();
  };
  roomObserver = new ResizeObserver(positionLabel);
  roomObserver.observe(room);

  const skills = settings.skills || [];
  const groups = new Map<ObjectKind, Group>();
  for (const skill of skills) {
    const [kind, title] = objectFor(skill.name);
    if (!groups.has(kind)) groups.set(kind, { title, skills: [] });
    groups.get(kind)!.skills.push(skill);
  }

  const showSkill = (skill: Skill, group: Group) => {
    detail.replaceChildren(el('h3', '', skill.name));
    const studied = skill.name.startsWith('Изучено:');
    detail.append(el('p', '', studied
      ? 'Ты познакомился с этим элементом. Самостоятельное выполнение ещё можно потренировать.'
      : 'Ты уже освоил это действие. Можно повторить его ещё раз.'));
    if (!studied) {
      const repeat = el('button', 'home-action', 'Повторить навык');
      repeat.onclick = () => {
        closeHome();
        const known = lessons().find((l) => l.name === skill.name);
        if (known) known.start(); else routeGoal(skill.name.replace(/^Самостоятельно: /, ''));
      };
      detail.append(repeat);
    }
    if (group.skills.length > 1) {
      const all = el('button', 'home-action home-secondary', 'Все открытия этого предмета');
      all.onclick = () => showGroup(group);
      detail.append(all);
    }
  };
  const showGroup = (group: Group) => {
    if (group.skills.length === 1) { showSkill(group.skills[0]!, group); return; }
    detail.replaceChildren(el('h3', '', group.title), el('p', '', 'Выбери, что хочешь вспомнить:'));
    for (const skill of group.skills) {
      const item = el('button', 'home-action home-secondary', skill.name);
      item.onclick = () => showSkill(skill, group);
      detail.append(item);
    }
  };

  if (!skills.length) room.append(el('div', 'home-empty', 'Комната ждёт твоих открытий. Пройди первый урок — здесь появится предмет.'));
  for (const [kind, group] of groups) {
    const button = el('button', `home-object room-object-${kind}`);
    button.type = 'button';
    button.setAttribute('aria-label', `${group.title}: ${group.skills.map((s) => s.name).join(', ')}`);
    const art = el('span', `home-item-art home-art-${kind}`);
    art.setAttribute('aria-hidden', 'true');
    button.append(art);
    const hideLabel = () => { if (!button.classList.contains('selected')) tooltip.classList.add('hidden'); };
    button.addEventListener('mouseenter', () => labelFor(button, group.title));
    button.addEventListener('focus', () => labelFor(button, group.title));
    button.addEventListener('mouseleave', () => { if (document.activeElement !== button) hideLabel(); });
    button.addEventListener('blur', hideLabel);
    if (group.skills.length > 1) button.append(el('span', 'room-object-count', String(group.skills.length)));
    button.onclick = () => {
      room.querySelectorAll('.home-object').forEach((b) => b.classList.remove('selected'));
      button.classList.add('selected');
      labelFor(button, group.title);
      showGroup(group);
    };
    room.append(button);
  }
  h.append(el('div', 'room-caption', `${skills.length} открытий · ${groups.size} предметов в комнате`));
  h.append(room, detail);
  const card = settings.firstSuccessCard;
  if (card) {
    const b = el('button', 'home-action', 'Открытка первого успеха');
    b.onclick = () => showPostcard(card);
    h.append(b);
  }
  document.body.append(h);
  home = h;
  h.querySelector('button')?.focus();
}

export function initSkillHome(): void {
  api.on('skill-earned', (event) => {
    if (home) openHome();
    const card = event.card;
    if (event.first && card) {
      settings.firstSuccessCard = card;
      setTimeout(() => showPostcard(card), 200);
    }
  });
  $('#open-skill-home').onclick = openHome;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (postcardOpen()) closePostcard();
    else if (home) closeHome();
  });
}
