// Общее состояние главного процесса: окно кота и значок в трее, плюс маленькие помощники.
import { Notification, type BrowserWindow, type Tray } from 'electron';
import path from 'node:path';
import type { PushikEvent, PushikEvents } from '../shared/types';
import { ASSETS } from './paths';

export const state: { win: BrowserWindow | null; tray: Tray | null } = { win: null, tray: null };

/** Окно кота, если оно живо. */
export function win(): BrowserWindow | null {
  return state.win && !state.win.isDestroyed() ? state.win : null;
}

// Сообщение в окно кота. Если окна ещё (или уже) нет, ничего не делаем.
export function send<E extends PushikEvent>(channel: E, ...data: PushikEvents[E] extends undefined ? [] : [PushikEvents[E]]): void {
  win()?.webContents.send(channel, ...data);
}

// Показать кота, не забирая фокус у программы, в которой работает человек.
export function showInactive(): void { win()?.showInactive(); }
export function show(): void { win()?.show(); }

export function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: path.join(ASSETS, 'icon.png') }).show();
}
