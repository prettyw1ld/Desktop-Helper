// Главный процесс Пушика: запуск, связь модулей между собой и выход.
// Сами части лежат в src/app/: настройки, окно кота, трей, напоминания, наблюдатели, IPC.
const { app, session, globalShortcut } = require('electron');
const guide = require('./guide');
const locate = require('./locate');
const I18N = require('./renderer/i18n');
const protocol = require('./app/protocol');
const settings = require('./app/settings');
const reminders = require('./app/reminders');
const watchers = require('./app/watchers');
const autostart = require('./app/autostart');
const overlay = require('./app/overlay');
const tray = require('./app/tray');
const ipc = require('./app/ipc');
const ui = require('./app/ui');

protocol.register();
ipc.register();

// Что делать, когда человек поменял настройки
settings.onChange((s, prev) => {
  autostart.apply(s.autostart);
  I18N.setLang(s.lang);
  if (prev.lang !== s.lang || prev.autostart !== s.autostart || settings.hasAi(prev) !== settings.hasAi(s)) tray.rebuildMenu();
  if (prev.catColor !== s.catColor) tray.refreshIcon();
  if (prev.calendarUrl !== s.calendarUrl || prev.calendarBefore !== s.calendarBefore) watchers.startCalendar();
  if (prev.windows !== s.windows) watchers.startWindowsWatch();
});

function onReady() {
  if (process.platform === 'darwin') app.dock?.hide();
  const s = settings.load();
  I18N.setLang(s.lang);
  // Сверяем автозапуск с настройкой при каждом старте: путь к приложению мог поменяться
  // (обновление, перенос папки), а старые версии записывали его только при сохранении настроек.
  autostart.apply(s.autostart);
  // микрофон нужен для голосового ввода, остальное окну не нужно
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  protocol.serve();
  overlay.createWindow({
    onLoad: () => {
      reminders.load();
      watchers.startCalendar();
      watchers.startWindowsWatch();
    },
  });
  tray.createTray();
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    ui.show();
    ui.send('open', 'chat');
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => ui.showInactive());
  app.whenReady().then(onReady);
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    guide.unwatch();
    locate.stop();
    watchers.stopAll();
  });
  app.on('window-all-closed', () => app.quit());
}
