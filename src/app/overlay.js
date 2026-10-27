// Окно кота: одно прозрачное окно на всю рабочую область основного экрана.
// Клики проходят сквозь пустые места; окно ловит мышь только над котом и панелями.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { SRC } = require('./paths');
const ui = require('./ui');

function createWindow({ onLoad } = {}) {
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    ...workArea,
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
      preload: path.join(SRC, 'preload.js'),
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
  win.loadFile(path.join(SRC, 'renderer', 'index.html'));
  require('../http').setOnWait((sec) => ui.send('ai-wait', sec));
  // Напоминания и прочее запускаем, когда окно готово, чтобы просроченные успели показаться котом.
  if (onLoad) win.webContents.once('did-finish-load', onLoad);

  const fitToScreen = () => { if (!win.isDestroyed()) win.setBounds(screen.getPrimaryDisplay().workArea); };
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
  win.on('closed', () => {
    clearInterval(topTimer);
    screen.off('display-metrics-changed', fitToScreen);
    screen.off('display-added', fitToScreen);
    screen.off('display-removed', fitToScreen);
    if (ui.state.win === win) ui.state.win = null;
  });
  return win;
}

function toggleVisible() {
  if (!ui.alive()) return;
  // кот уходит вглубь экрана (анимация в окне) и потом прячется; появляется бегом
  if (ui.state.win.isVisible()) ui.send('open', 'hide');
  else { ui.showInactive(); ui.send('open', 'show'); }
}

// Экранные пиксели → координаты окна кота. Масштаб берём у того монитора, где кнопка.
// Кнопку на другом мониторе (окно кота только на основном) не показываем: null.
function toOverlayRect(r, keep = false) {
  const wa = screen.getPrimaryDisplay().workArea;
  const raw = { x: r.x, y: r.y, width: r.w, height: r.h };
  const d = process.platform === 'win32' ? screen.screenToDipRect(null, raw) : raw;
  const o = { x: Math.round(d.x - wa.x), y: Math.round(d.y - wa.y), w: Math.round(d.width), h: Math.round(d.height) };
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  if (!keep && (cx < 0 || cy < 0 || cx > wa.width || cy > wa.height)) return null;
  return o;
}

module.exports = { createWindow, toggleVisible, toOverlayRect };
