// Окно кота: одно прозрачное окно на всю рабочую область основного экрана.
// Клики проходят сквозь пустые места; окно ловит мышь только над котом и панелями.
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { Rect } from '../shared/types';
import { overlayBounds, toFrame, workInFrame } from './geometry';
import { setOnWait } from './ai/http';
import { BUILD } from './paths';
import * as ui from './ui';

export function createWindow({ onLoad }: { onLoad?: () => void } = {}): BrowserWindow {
  const win = new BrowserWindow({
    ...overlayBounds(screen.getPrimaryDisplay().bounds),
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(BUILD, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  ui.state.win = win;

  // Кот всегда поверх окон. На Windows новое окно или программа «поверх всех» может его перекрыть,
  // поэтому самый высокий уровень и регулярно поднимаем окно наверх (без перехвата фокуса).
  const keepOnTop = () => {
    if (win.isDestroyed() || !win.isVisible()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  };
  keepOnTop();
  win.on('always-on-top-changed', (_e, on) => { if (!on) setTimeout(keepOnTop, 50); });
  win.on('blur', () => setTimeout(keepOnTop, 150));
  const topTimer = setInterval(keepOnTop, 1500);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(BUILD, 'renderer', 'index.html'));
  setOnWait((sec) => ui.send('ai-wait', sec));
  // Напоминания и прочее запускаем, когда окно готово, чтобы просроченные успели показаться котом.
  if (onLoad) win.webContents.once('did-finish-load', onLoad);
  // где пол для кота: окно закрывает и панель задач, а гуляет кот над ней
  const sendWork = () => { const d = screen.getPrimaryDisplay(); ui.send('work-area', workInFrame(d.workArea, d.bounds)); };
  win.webContents.on('did-finish-load', sendWork);

  const fitToScreen = () => { if (!win.isDestroyed()) { win.setBounds(overlayBounds(screen.getPrimaryDisplay().bounds)); sendWork(); } };
  const events = ['display-metrics-changed', 'display-added', 'display-removed'] as const;
  for (const e of events) screen.on(e as 'display-added', fitToScreen);
  win.on('closed', () => {
    clearInterval(topTimer);
    for (const e of events) screen.off(e as 'display-added', fitToScreen);
    if (ui.state.win === win) ui.state.win = null;
  });
  return win;
}

export function toggleVisible(): void {
  const win = ui.win();
  if (!win) return;
  // кот уходит вглубь экрана (анимация в окне) и потом прячется; появляется бегом
  if (win.isVisible()) ui.send('open', 'hide');
  else { ui.showInactive(); ui.send('open', 'show'); }
}

// Экранные пиксели → координаты окна кота. Масштаб берём у того монитора, где кнопка.
// Кнопку на другом мониторе (окно кота только на основном) не показываем: null.
export function toOverlayRect(r: Rect, keep = false): Rect | null {
  const display = screen.getPrimaryDisplay();
  const raw = { x: r.x, y: r.y, width: r.w, height: r.h };
  const d = process.platform === 'win32' ? screen.screenToDipRect(null, raw) : raw;
  return toFrame({ x: d.x, y: d.y, w: d.width, h: d.height }, display.bounds, keep);
}
