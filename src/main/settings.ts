// Настройки: значения по умолчанию, ключи команды из team.json и settings.json человека.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { aiKey, isKeyed, PROVIDER_KEY, type KeyedProvider, type PublicSettings, type SecretKey, type Settings } from '../shared/types';
import { setAllowedOrigin } from './ai/http';
import { OPEN_PRIVACY } from './ai/privacy';
import * as stt from './ai/stt';
import * as locate from './system/locate';
import { ROOT, VOSK_MODEL } from './paths';
import { packsDir, readPacks, type Pack } from './packs';
import { ALL_FEATURES, allowedOrigin, enforce, LOCKED, policyFile, readPolicy, type Policy } from './policy';

export const DEFAULTS: Settings = {
  lang: '',
  provider: 'claude',
  aiChosen: false,
  aiUrl: '',
  groqKey: '',
  deepseekKey: '',
  qwenKey: '',
  apiKey: '',
  model: 'claude-sonnet-5-5',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3',
  calendarUrl: '',
  calendarBefore: 10,
  userName: '',
  size: 1,
  uiScale: 1,
  windows: true,
  sound: true,
  volume: 0.4,
  breakEvery: 0,
  chatter: false,            // выключено: новичка это сбивает
  speed: 1,
  autostart: true,           // новичок сам кота не найдёт
  autostartChosen: false,
  catColor: 'white',
  theme: 'cream',
  speak: true,
  voiceRate: 0.95,
  visionModel: '',
  sttUrl: stt.DEFAULT_URL,
  sttKey: '',
  sttModel: stt.DEFAULT_MODEL,
  tasks: [],
  skills: [],
  onboarded: false,
  contact: '',
  voice: 'offline',
  trustedRemote: [],
  shotConsent: false,
  glass: true,
};

const SECRETS: SecretKey[] = ['apiKey', 'calendarUrl', 'sttKey', 'groqKey', 'deepseekKey', 'qwenKey'];
const KEYED = Object.keys(PROVIDER_KEY) as KeyedProvider[];
const KEY_FIELDS: readonly string[] = Object.values(PROVIDER_KEY);
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// Ключи команды: team.json рядом с приложением (кладётся при сборке) или в папке настроек.
// Новичку ничего вводить не нужно. Если в team.json есть ИИ, его настройки главнее сохранённых:
// иначе старые настройки (например, provider: ollama из прошлых версий) перебивают ключ команды.
// Исключения: модель, которую человек сам выбрал в настройках (aiChosen), и ключи, которые он сам вписал.
const TEAM_AI = ['apiKey', 'groqKey', 'deepseekKey', 'qwenKey', 'provider', 'aiUrl', 'model', 'ollamaUrl', 'ollamaModel',
  'visionModel', 'sttUrl', 'sttKey', 'sttModel', 'voice'] as const;
// Адрес и модели выбранного сервиса: при смене сервиса берутся из его готовых настроек.
const MODEL_FIELDS = ['aiUrl', 'model', 'visionModel'] as const;
type TeamKey = typeof TEAM_AI[number];
type Team = Partial<Record<TeamKey, string>>;

let team: Team = {};
// Политика организации (корпоративный режим). Есть политика — team.json и ключи человека не действуют.
let policy: Policy | null = null;
export const managed = (): boolean => !!policy;
export const features = () => policy?.features ?? ALL_FEATURES;
export const privacy = () => policy?.privacy ?? OPEN_PRIVACY;
// ролевые пакеты организации; без политики их нет
let packList: Pack[] = [];
export const packs = (): readonly Pack[] => packList;
let current: Settings = { ...DEFAULTS };
const listeners: ((next: Settings, prev: Settings) => void)[] = [];

const readJson = (file: string): Record<string, unknown> | null => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
};

function loadTeam(): void {
  const places = [
    path.join(ROOT, 'team.json'),
    path.join(process.resourcesPath || '', 'team.json'),
    path.join(app.getPath('userData'), 'team.json'),
  ];
  const merged: Record<string, unknown> = {};
  for (const f of places) Object.assign(merged, readJson(f));
  team = Object.fromEntries(Object.entries(merged)
    .filter(([k, v]) => (TEAM_AI as readonly string[]).includes(k) && typeof v === 'string' && v)) as Team;
  splitKey(team);
  // ключи есть, а сервис не назван: берём первый, у которого есть ключ
  if (!team.provider) team.provider = KEYED.find((p) => team[PROVIDER_KEY[p]]);
}

// Старый формат: один apiKey и provider. Ключ сервиса с готовыми настройками переезжает в его поле.
function splitKey(c: { provider?: string; apiKey?: string } & Partial<Record<SecretKey, string>>): void {
  const p = c.provider || '';
  if (!isKeyed(p) || !c.apiKey) return;
  if (!c[PROVIDER_KEY[p]]) c[PROVIDER_KEY[p]] = c.apiKey;
  c.apiKey = '';
}

const teamHasAi = (): boolean => !!team.provider || !!team.apiKey || KEYED.some((p) => !!team[PROVIDER_KEY[p]]);

export function load(): Settings {
  policy = readPolicy();
  if (policy?.problem) console.error('policy:', policy.problem);
  packList = [];
  if (policy) {
    const set = readPacks(packsDir(policyFile()));
    packList = set.packs;
    for (const p of set.problems) console.error('pack:', p);
  }
  // в корпоративном режиме запросы к ИИ идут только на адрес из политики
  setAllowedOrigin(policy ? allowedOrigin(policy) : undefined);
  if (policy) team = {};
  else loadTeam();
  let s = { ...DEFAULTS, ...team } as Settings;
  const raw = readJson(settingsFile());
  if (raw) {
    s = { ...s, ...raw } as Settings;
    const loose = s as unknown as Record<string, unknown>;
    for (const k of SECRETS) {
      const enc = raw[`${k}Enc`];
      if (typeof enc === 'string' && safeStorage.isEncryptionAvailable()) {
        try { s[k] = safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { s[k] = ''; }
      }
      delete loose[`${k}Enc`];
    }
    // старые версии сохраняли autostart: false сами, хотя человек его не выключал
    if (!raw.autostartChosen) s.autostart = DEFAULTS.autostart;
  }
  s.chatter = false; // в настройках этого пункта больше нет, старое «вкл» не тянем
  s.contact = '';    // поле «Кому звонишь» убрано: урок звонка общий, без имени
  splitKey(s);
  if (teamHasAi()) {
    const loose = s as unknown as Record<string, unknown>;
    for (const k of TEAM_AI) {
      // ключи: свой ключ человека, иначе командный (пустая строка из старых настроек командный не затирает)
      if (KEY_FIELDS.includes(k)) { loose[k] = loose[k] || team[k] || ''; continue; }
      if (k === 'provider' && s.aiChosen) continue;   // модель человек выбрал сам
      loose[k] = k in team ? team[k] : DEFAULTS[k];
    }
  }
  // выбрана не та модель, что у команды: адрес и модели из готовых настроек этой модели
  if (s.aiChosen && team.provider && s.provider !== team.provider) for (const k of MODEL_FIELDS) s[k] = DEFAULTS[k];
  if (!s.lang) s.lang = app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en';
  if (policy) s = enforce(s, policy);
  current = s;
  return s;
}

export function save(next: Partial<Settings>): PublicSettings {
  const prev = current;
  if (policy) {
    // модель, адрес и ключи задаёт только политика: из окна их не поменять
    next = { ...next };
    for (const k of LOCKED) delete next[k];
  }
  let s: Settings = { ...current, ...next };
  if (policy) s = enforce(s, policy);
  if ('autostart' in next) s.autostartChosen = true;
  // сменили модель: её адрес и модели из team.json, если у команды та же, иначе готовые
  if (next.provider && next.provider !== prev.provider) {
    for (const k of MODEL_FIELDS) s[k] = (next.provider === team.provider ? team[k] : undefined) ?? DEFAULTS[k];
  }
  const toDisk: Record<string, unknown> = { ...s };
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

/** fn(next, prev) вызывается после каждого сохранения. */
export function onChange(fn: (next: Settings, prev: Settings) => void): void { listeners.push(fn); }

export const get = (): Settings => current;
export const hasAi = (s: Settings = current): boolean => (policy ? !!policy.ai : s.provider === 'ollama' || !!aiKey(s));

/** Настройки для запроса к ИИ: в apiKey — ключ выбранного сервиса. */
export const forAi = (s: Settings = current): Settings => ({ ...s, apiKey: aiKey(s) });

// Голос через Groq Whisper берёт ключ Groq, даже если чат и зрение идут через другой сервис
export function sttKeyFor(s: Settings = current): string {
  if (policy) return '';
  if (s.sttKey) return s.sttKey;
  if (!/groq\.com/.test(s.sttUrl || stt.DEFAULT_URL)) return '';
  return s.groqKey || (/groq\.com/.test(s.aiUrl || '') ? s.apiKey : '');
}

// В окно секреты целиком не отдаём, только признак, что они заданы.
export function publicView(): PublicSettings {
  const { apiKey: _apiKey, calendarUrl, sttKey: _sttKey, groqKey, deepseekKey, qwenKey, ...rest } = current;
  const field = isKeyed(current.provider) ? PROVIDER_KEY[current.provider] : 'apiKey';
  return {
    ...rest,
    hasApiKey: !!aiKey(current),
    hasCalendar: !!calendarUrl,
    hasStt: !!sttKeyFor(current) || !/groq\.com|openai\.com/.test(current.sttUrl || ''),
    hasVosk: fs.existsSync(VOSK_MODEL),
    aiReady: hasAi(current),
    teamKey: !!team[field] && current[field] === team[field],
    keys: { groq: !!groqKey, deepseek: !!deepseekKey, qwen: !!qwenKey },
    locator: locate.supported(),
    platform: process.platform,
    managed: !!policy,
    org: policy?.org ?? '',
    packLessons: packList.flatMap((p) => p.lessons),
    features: { ...features() },
  };
}
