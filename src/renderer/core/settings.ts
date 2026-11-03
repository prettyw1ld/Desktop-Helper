// Настройки в окне кота. Главный процесс присылает их без секретов (PublicSettings).
import type { PublicSettings, Skill } from '../../shared/types';

export const DEFAULT_SETTINGS: PublicSettings = {
  lang: 'ru', provider: 'claude', aiUrl: '', model: '', ollamaUrl: '', ollamaModel: '',
  calendarBefore: 10, userName: '', size: 1, uiScale: 1, windows: true, sound: true, volume: 0.4,
  breakEvery: 0, chatter: false, speed: 1, autostart: true, autostartChosen: false, catColor: 'white',
  speak: true, voiceRate: 0.95, visionModel: '', sttUrl: '', sttModel: '', tasks: [], skills: [],
  onboarded: false, contact: '', voice: 'offline',
  hasApiKey: false, hasCalendar: false, hasStt: false, hasVosk: false, aiReady: false, teamKey: false,
  locator: false, platform: 'win32',
};

/** Текущие настройки. Читать можно откуда угодно: модули видят обновления (live binding). */
export let settings: PublicSettings = { ...DEFAULT_SETTINGS };

export function setSettings(s: PublicSettings): void { settings = s; }
export function setSkills(skills: Skill[]): void { settings.skills = skills; }

export const isMac = (): boolean => settings.platform === 'darwin';
