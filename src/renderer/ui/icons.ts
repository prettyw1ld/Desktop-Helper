// Простые линейные иконки (SVG) для кнопок.
import { $$ } from '../core/dom';
import { T } from '../core/i18n';

const PATHS = {
  type: '<path d="m3 18 5-13 5 13M5 13h6m4 5 3-8 3 8m-5-3h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/>',
  award: '<circle cx="12" cy="8" r="5"/><path d="m8 12-2 9 6-3 6 3-2-9"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7"/>',
  heart: '<path d="M20 4c-3-3-7-1-8 1-1-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M4 2 1 5m19-3 3 3M7 21l-1 2m11-2 1 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  gear: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  paw: '<circle cx="8" cy="5" r="2"/><circle cx="16" cy="7" r="2"/><circle cx="5" cy="12" r="2"/><path d="M10 12c2-3 5-1 6 2s-1 5-4 4-5-3-2-6Z"/>',
  call: '<path d="m5 3 4 1 1 5-3 2c2 4 3 5 7 6l2-3 5 1v4c0 4-8 2-13-3S1 4 5 3Z"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m4 19 6-6 3 2 5-7 3 4"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4ZM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6Z"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v4m-4 0h8"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
} as const;

export type IconName = keyof typeof PATHS;

export const icon = (name: IconName): string =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

/** Иконка и подпись внутри кнопки. */
export function setIconLabel(button: Element, name: IconName, label: string): void {
  button.innerHTML = icon(name);
  const span = document.createElement('span');
  span.textContent = label;
  button.append(span);
}

const stripEmoji = (s: string): string => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();

/** Иконки у кнопок, которые есть в разметке с самого начала. */
export function initIcons(): void {
  for (const b of $$('[data-close]')) {
    b.innerHTML = icon('close');
    b.setAttribute('aria-label', b.title || 'Закрыть');
  }
  const go = document.querySelector('.ask .go');
  if (go) go.innerHTML = icon('send');
  const send = document.querySelector('#chat-form button[type=submit]');
  if (send) send.innerHTML = icon('send');
  refreshIcons();
}

/** После смены языка: подписи берутся заново из текстов. */
export function refreshIcons(): void {
  // главная кнопка — только текст, без иконки
  const first = document.querySelector('#inspect-element');
  if (first) first.textContent = stripEmoji(first.textContent ?? '');
  const extras: Record<string, IconName> = { chat: 'chat', settings: 'gear', lessons: 'book' };
  for (const [action, name] of Object.entries(extras)) {
    const e = document.querySelector<HTMLElement>(`.extras [data-act="${action}"]`);
    if (!e) continue;
    setIconLabel(e, name, T(`menu.${action}Short`));
    e.setAttribute('aria-label', e.title || action);
  }
}
