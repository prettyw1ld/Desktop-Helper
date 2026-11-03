// Настройки: значения по умолчанию, ключи команды из team.json и settings.json человека.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { PublicSettings, SecretKey, Settings } from '../shared/types';
import * as stt from './ai/stt';
import * as locate from './system/locate';
import { ROOT, VOSK_MODEL } from './paths';

export const DEFAULTS: Settings = {
  lang: '',
  provider: 'claude',
  aiUrl: '',
  groqKey: '',
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
};

const SECRETS: SecretKey[] = ['apiKey', 'calendarUrl', 'sttKey', 'groqKey'];
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// Ключи команды: team.json рядом с приложением (кладётся при сборке) или в папке настроек.
// Новичку ничего вводить не нужно. Если в team.json есть ИИ, его настройки главнее сохранённых:
// иначе старые настройки (например, provider: ollama из прошлых версий) перебивают ключ команды.
const TEAM_AI = ['apiKey', 'groqKey', 'provider', 'aiUrl', 'model', 'ollamaUrl', 'ollamaModel', 'visionModel', 'sttUrl', 'sttKey', 'sttModel', 'voice'] as const;
type TeamKey = typeof TEAM_AI[number];
type Team = Partial<Record<TeamKey, string>>;

let team: Team = {};
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
}

export function load(): Settings {
  loadTeam();
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
  // ключ Groq мог прийти под старым именем groqKey: для приложения это обычный apiKey
  if (team.groqKey && !team.apiKey) { team.apiKey = team.groqKey; team.provider = team.provider || 'groq'; }
  if (s.groqKey && !s.apiKey && (s.provider === 'groq' || !team.apiKey)) { s.apiKey = s.groqKey; s.provider = 'groq'; }
  if (team.provider || team.apiKey) {
    const loose = s as unknown as Record<string, unknown>;
    for (const k of TEAM_AI) loose[k] = k in team ? team[k] : DEFAULTS[k];
  }
  if (!s.lang) s.lang = app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en';
  current = s;
  return s;
}

export function save(next: Partial<Settings>): PublicSettings {
  const prev = current;
  const s: Settings = { ...current, ...next };
  if ('autostart' in next) s.autostartChosen = true;
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
export const hasAi = (s: Settings = current): boolean => s.provider === 'ollama' || !!s.apiKey;

// Голос через Groq может взять тот же ключ, что и чат, если ИИ тоже Groq
export function sttKeyFor(s: Settings = current): string {
  if (s.sttKey) return s.sttKey;
  const groqAi = s.provider === 'groq' || /groq\.com/.test(s.aiUrl || '');
  return groqAi && /groq\.com/.test(s.sttUrl || stt.DEFAULT_URL) ? s.apiKey : '';
}

// В окно секреты целиком не отдаём, только признак, что они заданы.
export function publicView(): PublicSettings {
  const { apiKey, calendarUrl, sttKey: _sttKey, groqKey: _groqKey, ...rest } = current;
  return {
    ...rest,
    hasApiKey: !!apiKey,
    hasCalendar: !!calendarUrl,
    hasStt: !!sttKeyFor(current) || !/groq\.com|openai\.com/.test(current.sttUrl || ''),
    hasVosk: fs.existsSync(VOSK_MODEL),
    aiReady: hasAi(current),
    teamKey: !!team.apiKey && apiKey === team.apiKey,
    locator: locate.supported(),
    platform: process.platform,
  };
}
