// Значок в трее и его меню.
const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const I18N = require('../renderer/i18n');
const { ASSETS } = require('./paths');
const settings = require('./settings');
const autostart = require('./autostart');
const { toggleVisible } = require('./overlay');
const ui = require('./ui');

const t = (k, v) => I18N.t(k, v);

// Открыть панель в окне кота. focus: окно забирает фокус (нужно, где человек будет печатать)
const open = (panel, focus = true) => () => {
  if (focus) ui.show(); else ui.showInactive();
  ui.send('open', panel);
};

function rebuildMenu() {
  if (!ui.state.tray) return;
  const s = settings.get();
  ui.state.tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.help'), click: open('help') },
    { label: t('tray.trainer'), click: open('trainer') },
    { type: 'separator' },
    { label: t('tray.call'), click: open('call', false) },
    ...(settings.hasAi(s) ? [{ label: t('tray.chat'), click: open('chat') }] : []),
    { label: t('tray.settings'), click: open('settings') },
    ...(autostart.supported() ? [{
      label: t('set.autostart'),
      type: 'checkbox',
      checked: !!s.autostart,
      click: (item) => ui.send('settings-changed', settings.save({ autostart: item.checked })),
    }] : []),
    { type: 'separator' },
    { label: t('tray.toggle'), click: toggleVisible },
    { label: t('tray.quit'), click: () => app.quit() },
  ]));
}

// Значок в трее — тот же пиксельный кот, что на экране, в выбранном цвете (рядом лежит @2x для чётких экранов)
function trayImage() {
  const color = settings.get().catColor;
  const name = ['white', 'ginger', 'black'].includes(color) ? color : 'white';
  const img = nativeImage.createFromPath(path.join(ASSETS, `tray-${name}.png`));
  return img.isEmpty() ? nativeImage.createFromPath(path.join(ASSETS, 'tray.png')) : img;
}

function refreshIcon() {
  if (ui.state.tray) ui.state.tray.setImage(trayImage());
}

function createTray() {
  const tray = new Tray(trayImage());
  ui.state.tray = tray;
  tray.setToolTip('Пушик');
  rebuildMenu();
  tray.on('click', toggleVisible);
  return tray;
}

module.exports = { createTray, rebuildMenu, refreshIcon };
