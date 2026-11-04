// Главный процесс Пушика: запуск, связь модулей между собой и выход.
// Части лежат рядом: настройки, окно кота, трей, напоминания, наблюдатели, IPC; ИИ в ai/, система в system/.
import { app, globalShortcut, session } from 'electron';
import { I18N } from '../shared/i18n';
import * as guide from './ai/guide';
import * as autostart from './autostart';
import * as ipc from './ipc';
import * as overlay from './overlay';
import * as protocol from './protocol';
import * as reminders from './reminders';
import * as settings from './settings';
import * as locate from './system/locate';
import * as tray from './tray';
import * as ui from './ui';
import * as watchers from './watchers';

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

function onReady(): void {
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
      // точная лапка в подсказках ИИ берёт кнопки через PowerShell: запускаем его заранее
      if (settings.hasAi()) setTimeout(() => locate.warm(), 4000);
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
