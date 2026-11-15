// Кто может звать главный процесс: только окно кота со своей страницы.
// Если в окно когда-нибудь попадёт чужая страница или фрейм (ссылка, ошибка навигации),
// она не получит доступ к снимкам экрана, файлам и настройкам (Electron security checklist, п. 17).
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILD } from './paths';

/** Страница кота без #… и ?…: только с неё разрешены вызовы. */
export const PAGE = pathToFileURL(path.join(BUILD, 'renderer', 'index.html')).href;

/** Адрес отправителя совпадает со страницей кота (сравниваем как URL, а не начало строки). */
export function trustedSender(url: string | undefined | null, page = PAGE, win = process.platform === 'win32'): boolean {
  if (!url) return false;
  const norm = (href: string): string => {
    const u = new URL(href);
    // file:///C:/… — буквы диска и кириллица в пути могут прийти в разном виде: сравниваем раскодированный путь
    const p = decodeURIComponent(u.pathname);
    return `${u.protocol}//${u.host}${win ? p.toLowerCase() : p}`;
  };
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && norm(u.href) === norm(page);
  } catch { return false; }
}

const senderUrl = (e: IpcMainEvent | IpcMainInvokeEvent): string | undefined => e.senderFrame?.url;

/**
 * Обернуть ipcMain.handle и ipcMain.on: вызов не со страницы кота отклоняется и пишется в консоль.
 * Вызывать до регистрации обработчиков.
 */
export function install(page = PAGE): void {
  const handle = ipcMain.handle.bind(ipcMain);
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, (e, ...args) => {
    if (!trustedSender(senderUrl(e), page)) { console.error('ipc: refused', channel, senderUrl(e)); throw new Error('untrusted sender'); }
    return listener(e, ...args);
  });
  ipcMain.on = (channel, listener) => on(channel, (e, ...args) => {
    if (!trustedSender(senderUrl(e), page)) { console.error('ipc: refused', channel, senderUrl(e)); return; }
    listener(e, ...args);
  });
}
