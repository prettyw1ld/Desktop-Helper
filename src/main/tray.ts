// Значок в трее и его меню.
import { app, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { logFile } from './ai/guide-log';
import path from 'node:path';
import { T } from '../shared/i18n';
import * as autostart from './autostart';
import { toggleVisible } from './overlay';
import { ASSETS } from './paths';
import * as settings from './settings';
import * as ui from './ui';

// Открыть панель в окне кота. focus: окно забирает фокус (нужно, где человек будет печатать)
const open = (panel: string, focus = true) => () => {
  if (focus) ui.show(); else ui.showInactive();
  ui.send('open', panel);
};

export function rebuildMenu(): void {
  if (!ui.state.tray) return;
  const s = settings.get();
  const items: MenuItemConstructorOptions[] = [
    { label: T('tray.help'), click: open('help') },
    { label: T('tray.trainer'), click: open('trainer') },
    { type: 'separator' },
    { label: T('tray.call'), click: open('call', false) },
  ];
  if (settings.hasAi(s)) items.push({ label: T('tray.chat'), click: open('chat') });
  items.push({ label: T('tray.settings'), click: open('settings') });
  if (autostart.supported()) {
    items.push({
      label: T('set.autostart'),
      type: 'checkbox',
      checked: !!s.autostart,
      click: (item) => ui.send('settings-changed', settings.save({ autostart: item.checked })),
    });
  }
  items.push(
    { type: 'separator' },
    { label: T('tray.toggle'), click: toggleVisible },
    // для команды: что делал помощник (тайминги, куда показал), чтобы разбирать промахи и тормоза
    ...(settings.hasAi(s) ? [{ label: T('tray.log'), click: () => { void shell.openPath(logFile()); } }] : []),
    { label: T('tray.quit'), click: () => app.quit() },
  );
  ui.state.tray.setContextMenu(Menu.buildFromTemplate(items));
}

// Значок в трее — тот же пиксельный кот, что на экране, в выбранном цвете (рядом лежит @2x для чётких экранов)
function trayImage(): Electron.NativeImage {
  const color = settings.get().catColor;
  const name = ['white', 'ginger', 'black'].includes(color) ? color : 'white';
  return nativeImage.createFromPath(path.join(ASSETS, `tray-${name}.png`));
}

export function refreshIcon(): void {
  ui.state.tray?.setImage(trayImage());
}

export function createTray(): Tray {
  const tray = new Tray(trayImage());
  ui.state.tray = tray;
  tray.setToolTip('Пушик');
  rebuildMenu();
  tray.on('click', toggleVisible);
  return tray;
}
