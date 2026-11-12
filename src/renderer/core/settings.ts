// Настройки в окне кота. Главный процесс присылает их без секретов (PublicSettings).
import type { PublicSettings, Skill } from '../../shared/types';
import { setPackLessons } from '../guide/scenarios';

export const DEFAULT_SETTINGS: PublicSettings = {
  lang: 'ru', provider: 'claude', aiChosen: false, aiUrl: '', model: '', ollamaUrl: '', ollamaModel: '',
  calendarBefore: 10, userName: '', size: 1, uiScale: 1, windows: true, sound: true, volume: 0.4,
  breakEvery: 0, chatter: false, speed: 1, autostart: true, autostartChosen: false, catColor: 'white', theme: 'cream',
  speak: true, voiceRate: 0.95, visionModel: '', sttUrl: '', sttModel: '', tasks: [], skills: [],
  onboarded: false, contact: '', voice: 'offline', trustedRemote: [], shotConsent: false, glass: true,
  hasApiKey: false, hasCalendar: false, hasStt: false, hasVosk: false, aiReady: false, teamKey: false,
  keys: { groq: false, deepseek: false, qwen: false },
  locator: false, platform: 'win32',
  managed: false, org: '', features: { chat: true, guide: true, inspect: true }, packLessons: [], packReports: [], host: '',
};

/** Текущие настройки. Читать можно откуда угодно: модули видят обновления (live binding). */
export let settings: PublicSettings = { ...DEFAULT_SETTINGS };

export function setSettings(s: PublicSettings): void {
  settings = s;
  setPackLessons(s.packLessons ?? []);
}
export function setSkills(skills: Skill[]): void { settings.skills = skills; }

/** ИИ подключён и эта возможность не выключена политикой организации. */
export const can = (f: keyof PublicSettings['features']): boolean => settings.aiReady && settings.features[f];

export const isMac = (): boolean => settings.platform === 'darwin';
