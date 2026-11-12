// Главный процесс Пушика: запуск, связь модулей между собой и выход.
// Части лежат рядом: настройки, окно кота, трей, напоминания, наблюдатели, IPC; ИИ в ai/, система в system/.
import { app, globalShortcut, session } from 'electron';
import { I18N } from '../shared/i18n';
import * as guide from './ai/guide';
import * as autostart from './autostart';
import * as ipc from './ipc';
import * as overlay from './overlay';
import * as presence from './presence-agent';
import * as protocol from './protocol';
import * as reminders from './reminders';
import * as settings from './settings';
import * as clicks from './system/clicks';
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
      watchers.startRemoteWatch();
      // точная лапка в подсказках ИИ берёт кнопки через PowerShell: запускаем его заранее
      if (settings.hasAi()) setTimeout(() => locate.warm(), 4000);
    },
  });
  tray.createTray();
  // админ-панель организации видит, что кот бодрствует; выход из сеанса Windows — «ушёл спать»
  presence.start(settings.presence());
  ui.win()?.on('session-end', () => { void presence.bye('logoff'); });
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    ui.show();
    ui.send('open', 'chat');
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => ui.showInactive());
  // Окно кота показывает только свою страницу: никаких переходов, новых окон и встроенных страниц
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('will-attach-webview', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  app.whenReady().then(onReady);
  // перед выходом успеваем сказать серверу «сплю» (не дольше 1,5 с)
  app.on('before-quit', (e) => {
    if (!presence.active()) return;
    e.preventDefault();
    void presence.bye('quit').finally(() => app.quit());
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    guide.unwatch();
    locate.stop();
    clicks.stop();
    watchers.stopAll();
  });
  app.on('window-all-closed', () => app.quit());
}
