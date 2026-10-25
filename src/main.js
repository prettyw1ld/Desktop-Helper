const {
  app, BrowserWindow, screen, ipcMain, Tray, Menu, Notification,
  nativeImage, globalShortcut, safeStorage, session, systemPreferences, protocol, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { ask, ollamaModels } = require('./llm');
const calendar = require('./calendar');
const windowsWatch = require('./windows');
const guide = require('./guide');
const locate = require('./locate');
const stt = require('./stt');
const I18N = require('./renderer/i18n');

const t = (k, v) => I18N.t(k, v);
const ASSETS = path.join(__dirname, '..', 'assets');
const VOSK_MODEL = path.join(ASSETS, 'vosk', 'model-ru.tar.gz');

// pushik://vosk/model-ru.tar.gz: так распознаватель речи (он работает в Web Worker) может скачать модель из приложения
protocol.registerSchemesAsPrivileged([{
  scheme: 'pushik', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);
function serveAssets() {
  protocol.handle('pushik', (req) => {
    const u = new URL(req.url);
    const file = path.normalize(path.join(ASSETS, u.hostname, decodeURIComponent(u.pathname)));
    if (!file.startsWith(ASSETS) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    const headers = { 'access-control-allow-origin': '*', 'content-length': String(fs.statSync(file).size) };
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers });
  });
}
let win = null;
let tray = null;

// ---------- Настройки ----------
const DEFAULTS = {
  lang: '',                // '' = по языку системы
  provider: 'claude',      // claude | ollama
  apiKey: '',
  model: 'claude-sonnet-5-5',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3',
  calendarUrl: '',         // секретный iCal-адрес Google Календаря
  calendarBefore: 10,      // за сколько минут предупреждать о встрече
  userName: '',
  size: 1,                 // размер кота
  windows: true,           // гулять по краям окон
  sound: true,
  volume: 0.4,
  breakEvery: 50,          // минут между напоминаниями о перерыве, 0 = выключено
  chatter: true,           // кот иногда сам что-то говорит
  speed: 1,                // множитель скорости ходьбы
  autostart: false,
  // помощник для новичка
  catColor: 'white',       // white | ginger | black
  speak: true,             // читать подсказки вслух
  voiceRate: 0.95,
  visionModel: '',         // модель Ollama с зрением (qwen2.5vl, llava); пусто = ollamaModel
  sttUrl: stt.DEFAULT_URL, // Whisper-совместимый сервис для голоса
  sttKey: '',
  sttModel: stt.DEFAULT_MODEL,
  tasks: [],               // свои кнопки-задачи; пусто = стандартные
  skills: [],              // «Что я уже умею»: [{ name, at }]
  onboarded: false,        // пройден ли тренажёр мыши при первом запуске
  contact: '',             // кому чаще всего звонят: имя, как в WhatsApp (для сценария «Позвонить»)
  voice: 'offline',        // offline = Vosk в самом приложении, whisper = сервис по ключу
};
const SECRETS = ['apiKey', 'calendarUrl', 'sttKey'];
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// Ключи команды: team.json рядом с приложением (кладётся при сборке) или в папке настроек.
// Новичку ничего вводить не нужно. Свои значения из настроек важнее командных.
let team = {};
function loadTeam() {
  const places = [path.join(__dirname, '..', 'team.json'), path.join(process.resourcesPath || '', 'team.json'), path.join(app.getPath('userData'), 'team.json')];
  for (const f of places) {
    try { team = { ...team, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { /* файла нет */ }
  }
  const allowed = ['apiKey', 'provider', 'model', 'ollamaUrl', 'ollamaModel', 'visionModel', 'sttUrl', 'sttKey', 'sttModel', 'voice'];
  team = Object.fromEntries(Object.entries(team).filter(([k, v]) => allowed.includes(k) && typeof v === 'string' && v));
}

function loadSettings() {
  loadTeam();
  let s = { ...DEFAULTS, ...team };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    s = { ...s, ...raw };
    for (const k of SECRETS) {
      if (raw[`${k}Enc`] && safeStorage.isEncryptionAvailable()) {
        s[k] = safeStorage.decryptString(Buffer.from(raw[`${k}Enc`], 'base64'));
      }
      delete s[`${k}Enc`];
    }
  } catch { /* первый запуск */ }
  if (!s.lang) s.lang = app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en';
  return s;
}

function saveSettings(next) {
  const prev = settings;
  const s = { ...settings, ...next };
  const toDisk = { ...s };
  // командные ключи не копируем в настройки человека
  for (const [k, v] of Object.entries(team)) if (toDisk[k] === v) delete toDisk[k];
  // ключ API и адрес календаря секретные: шифруем средствами системы
  for (const k of SECRETS) {
    if (!(k in toDisk)) continue;
    if (s[k] && safeStorage.isEncryptionAvailable()) {
      toDisk[`${k}Enc`] = safeStorage.encryptString(s[k]).toString('base64');
      delete toDisk[k];
    }
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(toDisk, null, 2));
  settings = s;
  app.setLoginItemSettings({ openAtLogin: !!s.autostart });
  I18N.setLang(s.lang);
  if (prev.lang !== s.lang) createTrayMenu();
  if (prev.calendarUrl !== s.calendarUrl || prev.calendarBefore !== s.calendarBefore) startCalendar();
  if (prev.windows !== s.windows) startWindowsWatch();
  return publicSettings();
}

// В окно секреты целиком не отдаём, только признак, что они заданы.
function publicSettings() {
  const { apiKey, calendarUrl, sttKey, ...rest } = settings;
  return {
    ...rest, hasApiKey: !!apiKey, hasCalendar: !!calendarUrl, hasStt: !!sttKey || !/groq\.com|openai\.com/.test(settings.sttUrl || ''),
    hasVosk: fs.existsSync(VOSK_MODEL),
    aiReady: settings.provider === 'ollama' || !!apiKey,
    teamKey: !!team.apiKey && apiKey === team.apiKey,
    locator: locate.supported(),
    platform: process.platform,
  };
}

let settings = DEFAULTS;

// ---------- Напоминания ----------
const remindersFile = () => path.join(app.getPath('userData'), 'reminders.json');
let reminders = [];
const timers = new Map();

function persistReminders() {
  fs.writeFileSync(remindersFile(), JSON.stringify(reminders, null, 2));
  win?.webContents.send('reminders-changed', reminders);
}

function scheduleReminder(r) {
  const delay = Math.max(0, r.at - Date.now());
  // setTimeout не любит задержки больше ~24 дней
  if (delay > 2 ** 31 - 1) return;
  timers.set(r.id, setTimeout(() => fireReminder(r.id), delay));
}

function addReminder({ minutes, text, kind = 'reminder' }) {
  const r = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now() + Math.round(Number(minutes) * 60_000),
    text: String(text || t('rem.default')),
    kind,
  };
  reminders.push(r);
  scheduleReminder(r);
  persistReminders();
  return r;
}

function cancelReminder(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const before = reminders.length;
  reminders = reminders.filter((r) => r.id !== id);
  persistReminders();
  return reminders.length < before;
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: path.join(ASSETS, 'icon.png') }).show();
}

function fireReminder(id) {
  const r = reminders.find((x) => x.id === id);
  if (!r) return;
  cancelReminder(id);
  notify(r.kind === 'focus' ? t('notif.focus') : t('notif.reminder'), r.text);
  win?.showInactive();
  win?.webContents.send('reminder', r);
}

function loadReminders() {
  try { reminders = JSON.parse(fs.readFileSync(remindersFile(), 'utf8')); } catch { reminders = []; }
  // Пропущенные, пока приложение было закрыто, покажем сразу после старта.
  reminders.forEach(scheduleReminder);
}

// ---------- Календарь ----------
function startCalendar() {
  calendar.start({
    url: settings.calendarUrl,
    before: Number(settings.calendarBefore) || 10,
    onSoon: (e, min) => {
      const text = min > 0 ? t('cal.soon', { min, title: e.title }) : t('cal.now', { title: e.title });
      notify(t('notif.calendar'), text);
      win?.showInactive();
      win?.webContents.send('calendar-soon', { ...e, min, text });
    },
  }).then(() => win?.webContents.send('calendar-changed'));
}

function calendarList(days) {
  return { ...calendar.status(), events: calendar.upcoming(days) };
}

// ---------- Окна других программ ----------
function startWindowsWatch() {
  windowsWatch.stop();
  win?.webContents.send('windows', []);
  if (!settings.windows) return;
  const toDip = (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r);
  windowsWatch.start((list) => {
    // переводим в координаты нашего окна (оно занимает рабочую область основного экрана)
    const wa = screen.getPrimaryDisplay().workArea;
    win?.webContents.send('windows', list.map(([id, x, y, w, h]) => [id, x - wa.x, y - wa.y, w, h]));
  }, toDip);
}

// ---------- Окно ----------
// Одно прозрачное окно на всю рабочую область основного экрана.
// Клики проходят сквозь пустые места; окно ловит мышь только над котом и панелями.
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Напоминания грузим, когда окно готово, чтобы просроченные успели показаться котом.
  win.webContents.once('did-finish-load', () => {
    loadReminders();
    startCalendar();
    startWindowsWatch();
  });

  const fitToScreen = () => win && win.setBounds(screen.getPrimaryDisplay().workArea);
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
}

function toggleVisible() {
  if (!win) return;
  // кот уходит вглубь экрана (анимация в окне) и потом прячется; появляется бегом
  if (win.isVisible()) win.webContents.send('open', 'hide');
  else { win.showInactive(); win.webContents.send('open', 'show'); }
}

function createTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.help'), click: () => { win.show(); win.webContents.send('open', 'help'); } },
    { label: t('tray.trainer'), click: () => { win.show(); win.webContents.send('open', 'trainer'); } },
    { type: 'separator' },
    { label: t('tray.call'), click: () => { win.showInactive(); win.webContents.send('open', 'call'); } },
    { label: t('tray.chat'), click: () => { win.show(); win.webContents.send('open', 'chat'); } },
    { label: t('tray.reminders'), click: () => { win.show(); win.webContents.send('open', 'reminders'); } },
    { label: t('tray.settings'), click: () => { win.show(); win.webContents.send('open', 'settings'); } },
    { type: 'separator' },
    { label: t('tray.toggle'), click: toggleVisible },
    { label: t('tray.quit'), click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('Пушик');
  createTrayMenu();
  tray.on('click', toggleVisible);
}

// ---------- IPC ----------
ipcMain.on('ignore-mouse', (_e, ignore) => {
  if (!win) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:save', (_e, s) => {
  const res = saveSettings(s);
  win?.webContents.send('settings-changed', res);
  return res;
});
ipcMain.handle('ollama:models', (_e, url) => ollamaModels(url || settings.ollamaUrl));
ipcMain.handle('reminders:add', (_e, r) => addReminder(r));
ipcMain.handle('reminders:list', () => reminders);
ipcMain.handle('reminders:cancel', (_e, id) => cancelReminder(id));
ipcMain.handle('calendar:list', (_e, days) => calendarList(days || 2));
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:hide', () => win?.hide());

// ---------- Поиск кнопок без ИИ ----------
function toOverlayRect(r) {
  const wa = screen.getPrimaryDisplay().workArea;
  const d = process.platform === 'win32' ? screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h }) : { x: r.x, y: r.y, width: r.w, height: r.h };
  return { x: Math.round(d.x - wa.x), y: Math.round(d.y - wa.y), w: Math.round(d.width), h: Math.round(d.height) };
}
ipcMain.handle('locate', (_e, q) => locate.ask(q, toOverlayRect));
// «Открой за меня»: только безопасные адреса (настройки Windows, WhatsApp, Telegram, сайты) и флешка
ipcMain.handle('open:uri', (_e, uri) => {
  const u = String(uri || '');
  if (!/^(ms-settings:|whatsapp:|tg:|https:\/\/)/.test(u)) return false;
  shell.openExternal(u);
  return true;
});
ipcMain.handle('open:drive', (_e, letter) => {
  const l = String(letter || '');
  if (process.platform === 'win32' && /^[A-Z]$/i.test(l)) shell.openPath(`${l}:\\`);
  else if (process.platform === 'darwin' && l && !l.includes('/')) shell.openPath(`/Volumes/${l}`);
  return true;
});

// ---------- Помощник: снимок экрана и подсказка ----------
function screenAccess() {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}
ipcMain.handle('guide:look', async (_e, req) => {
  const useOllama = settings.provider === 'ollama';
  if (!useOllama && !settings.apiKey) return { error: t('err.noKey') };
  if (screenAccess() === 'denied') return { error: t('err.screen') };
  try {
    return await guide.look({ ...req, settings, overlay: win });
  } catch (err) {
    if (err.code === 'noShot') return { error: t('err.screen') };
    if (err.offline) return { error: t('err.ollama', { url: settings.ollamaUrl }) };
    return { error: t('err.look', { err: err.message }) };
  }
});
ipcMain.on('guide:watch', (_e, masks) => {
  guide.watch({ masks, onChange: () => win?.webContents.send('screen-changed') });
});
ipcMain.on('guide:unwatch', () => guide.unwatch());

// ---------- Голос ----------
ipcMain.handle('stt:transcribe', async (_e, { audio, mime }) => {
  try {
    const text = await stt.transcribe(settings, Buffer.from(audio), mime);
    return { text };
  } catch (err) {
    return { error: t('err.stt', { err: err.message }) };
  }
});
ipcMain.handle('mic:ask', async () => {
  if (process.platform !== 'darwin') return true;
  try { return await systemPreferences.askForMediaAccess('microphone'); } catch { return false; }
});
ipcMain.handle('skills:add', (_e, name) => {
  const n = String(name || '').trim();
  if (!n) return settings.skills;
  const skills = (settings.skills || []).filter((x) => x.name.toLowerCase() !== n.toLowerCase());
  skills.push({ name: n, at: Date.now() });
  saveSettings({ skills });
  return skills;
});

// История чата живёт только в памяти, пока запущено приложение.
let chatHistory = [];
ipcMain.handle('chat:reset', () => { chatHistory = []; return true; });
ipcMain.handle('chat:send', async (_e, text) => {
  const useOllama = settings.provider === 'ollama';
  if (!useOllama && !settings.apiKey) return { error: t('err.noKey') };
  const locale = settings.lang === 'en' ? 'en-US' : 'ru-RU';
  try {
    const { reply, history, actions } = await ask({
      ...settings,
      history: chatHistory,
      text,
      tools: {
        set_reminder: ({ minutes, text: txt }) => {
          const r = addReminder({ minutes, text: txt });
          return `Reminder set for ${new Date(r.at).toLocaleTimeString(locale)}`;
        },
        list_reminders: () => JSON.stringify(reminders.map((r) => ({
          id: r.id, text: r.text, kind: r.kind, at: new Date(r.at).toLocaleString(locale),
        }))),
        cancel_reminder: ({ id }) => (cancelReminder(id) ? 'Cancelled' : 'No such reminder'),
        start_focus: ({ minutes }) => {
          addReminder({ minutes, text: t('say.focusEnd', { min: minutes }), kind: 'focus' });
          return `Focus session for ${minutes} min started`;
        },
        get_calendar_events: async ({ days }) => {
          if (!settings.calendarUrl) return 'Calendar is not connected (the user can paste the iCal address in settings).';
          await calendar.refresh();
          const { error, events } = calendarList(days || 1);
          if (error) return `Calendar error: ${error}`;
          return JSON.stringify(events.map((e) => ({
            title: e.title,
            start: e.allDay ? new Date(e.start).toLocaleDateString(locale) : new Date(e.start).toLocaleString(locale),
            end: e.allDay ? undefined : new Date(e.end).toLocaleTimeString(locale),
            allDay: e.allDay || undefined,
            location: e.location || undefined,
          })));
        },
      },
    });
    chatHistory = history.slice(-30);
    return { reply, actions };
  } catch (err) {
    if (err.offline) return { error: t('err.ollama', { url: settings.ollamaUrl }) };
    return { error: t('err.ask', { who: useOllama ? 'Ollama' : 'Claude', err: err.message }) };
  }
});

// ---------- Запуск ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win?.showInactive());
  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide();
    settings = loadSettings();
    I18N.setLang(settings.lang);
    // микрофон нужен для голосового ввода, остальное окну не нужно
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
    serveAssets();
    createWindow();
    createTray();
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      win.show();
      win.webContents.send('open', 'chat');
    });
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    guide.unwatch();
    locate.stop();
    windowsWatch.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
