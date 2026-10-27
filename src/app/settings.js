// Настройки: значения по умолчанию, ключи команды из team.json и settings.json человека.
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const stt = require('../stt');
const locate = require('../locate');
const { ROOT, VOSK_MODEL } = require('./paths');

const DEFAULTS = {
  lang: '',                // '' = по языку системы
  provider: 'claude',      // claude | groq | openrouter | openai | ollama
  aiUrl: '',               // адрес OpenAI-совместимого сервиса (для provider: openai)
  groqKey: '',             // старое имя ключа Groq из пакета команды; лучше apiKey
  apiKey: '',
  model: 'claude-sonnet-5-5',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3',
  calendarUrl: '',         // секретный iCal-адрес Google Календаря
  calendarBefore: 10,      // за сколько минут предупреждать о встрече
  userName: '',
  size: 1,                 // размер кота
  uiScale: 1,              // масштаб окон и подсказок, 0.7–1.4
  windows: true,           // гулять по краям окон
  sound: true,
  volume: 0.4,
  breakEvery: 0,           // минут между напоминаниями о перерыве, 0 = выключено
  chatter: false,          // кот сам что-то говорит без спроса (выключено: новичка это сбивает)
  speed: 1,                // множитель скорости ходьбы
  autostart: true,         // запускаться вместе с компьютером: новичок сам кота не найдёт
  autostartChosen: false,  // человек сам выбрал автозапуск (тогда не трогаем его выбор)
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
const SECRETS = ['apiKey', 'calendarUrl', 'sttKey', 'groqKey'];
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// Ключи команды: team.json рядом с приложением (кладётся при сборке) или в папке настроек.
// Новичку ничего вводить не нужно. Если в team.json есть ИИ, его настройки главнее сохранённых:
// иначе старые настройки (например, provider: ollama из прошлых версий) перебивают ключ команды.
const TEAM_AI = ['apiKey', 'groqKey', 'provider', 'aiUrl', 'model', 'ollamaUrl', 'ollamaModel', 'visionModel', 'sttUrl', 'sttKey', 'sttModel', 'voice'];
let team = {};
let current = { ...DEFAULTS };
const listeners = [];

function loadTeam() {
  const places = [path.join(ROOT, 'team.json'), path.join(process.resourcesPath || '', 'team.json'), path.join(app.getPath('userData'), 'team.json')];
  for (const f of places) {
    try { team = { ...team, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { /* файла нет */ }
  }
  team = Object.fromEntries(Object.entries(team).filter(([k, v]) => TEAM_AI.includes(k) && typeof v === 'string' && v));
}

function load() {
  loadTeam();
  let s = { ...DEFAULTS, ...team };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    s = { ...s, ...raw };
    for (const k of SECRETS) {
      if (raw[`${k}Enc`] && safeStorage.isEncryptionAvailable()) {
        try { s[k] = safeStorage.decryptString(Buffer.from(raw[`${k}Enc`], 'base64')); } catch { s[k] = ''; }
      }
      delete s[`${k}Enc`];
    }
    // старые версии сохраняли autostart: false сами, хотя человек его не выключал
    if (!raw.autostartChosen) s.autostart = DEFAULTS.autostart;
  } catch { /* первый запуск */ }
  s.chatter = false; // в настройках этого пункта больше нет, старое «вкл» не тянем
  s.contact = ''; // поле «Кому звонишь» убрано: урок звонка общий, без имени
  // ключ Groq мог прийти под старым именем groqKey: для приложения это обычный apiKey
  if (team.groqKey && !team.apiKey) { team.apiKey = team.groqKey; team.provider = team.provider || 'groq'; }
  if (s.groqKey && !s.apiKey && (s.provider === 'groq' || !team.apiKey)) { s.apiKey = s.groqKey; s.provider = 'groq'; }
  if (team.provider || team.apiKey) {
    for (const k of TEAM_AI) s[k] = k in team ? team[k] : DEFAULTS[k];
  }
  if (!s.lang) s.lang = app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en';
  current = s;
  return s;
}

function save(next) {
  const prev = current;
  const s = { ...current, ...next };
  if ('autostart' in next) s.autostartChosen = true;
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
  current = s;
  for (const fn of listeners) fn(s, prev);
  return publicView();
}

// fn(next, prev) вызывается после каждого сохранения
function onChange(fn) { listeners.push(fn); }

const get = () => current;
const hasAi = (s = current) => s.provider === 'ollama' || !!s.apiKey;

// Голос через Groq может взять тот же ключ, что и чат, если ИИ тоже Groq
function sttKeyFor(s = current) {
  if (s.sttKey) return s.sttKey;
  const groqAi = s.provider === 'groq' || /groq\.com/.test(s.aiUrl || '');
  return groqAi && /groq\.com/.test(s.sttUrl || stt.DEFAULT_URL) ? s.apiKey : '';
}

// В окно секреты целиком не отдаём, только признак, что они заданы.
function publicView() {
  const { apiKey, calendarUrl, sttKey, groqKey, ...rest } = current;
  return {
    ...rest, hasApiKey: !!apiKey, hasCalendar: !!calendarUrl, hasStt: !!sttKeyFor(current) || !/groq\.com|openai\.com/.test(current.sttUrl || ''),
    hasVosk: fs.existsSync(VOSK_MODEL),
    aiReady: hasAi(current),
    teamKey: !!team.apiKey && apiKey === team.apiKey,
    locator: locate.supported(),
    platform: process.platform,
  };
}

module.exports = { DEFAULTS, load, save, onChange, get, hasAi, sttKeyFor, publicView };
