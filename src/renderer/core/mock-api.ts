// Заглушка, чтобы интерфейс можно было открыть в обычном браузере для отладки:
// build/renderer/index.html?color=ginger&onboarded&ai&lang=en&platform=darwin
// window.__emit('windows', [[1, 200, 300, 500, 300]]) подсовывает окна.
import type { LocateItem, LookResult, PublicSettings, PushikApi, PushikEvent, PushikEvents, Reminder } from '../../shared/types';
import { DEFAULT_SETTINGS } from './settings';

declare global {
  interface Window {
    __emit?: <E extends PushikEvent>(ch: E, data: PushikEvents[E]) => void;
    __desk?: { top: { title: string; proc: string; close: { x: number; y: number; w: number; h: number } }; items: Record<string, LocateItem[]>; volume?: number };
  }
}

const step = (say: string, target: LookResult['target'] = null, status: LookResult['status'] = 'step'): LookResult =>
  ({ status, say, target, screenSummary: '', whatChanged: '', explain: '', skill: '', practiceGoal: '' });

const item = (name: string, x: number, y: number, w: number, h: number): LocateItem =>
  ({ name, x, y, w, h, type: 'Button', focused: false, enabled: true, proc: 'explorer' });

export function mockApi(): PushikApi {
  const q = new URLSearchParams(location.search);
  let list: Reminder[] = [];
  const handlers: Partial<Record<PushikEvent, (data: never) => void>> = {};
  window.__emit = (ch, data) => (handlers[ch] as ((d: typeof data) => void) | undefined)?.(data);
  const s: PublicSettings = {
    ...DEFAULT_SETTINGS,
    chatter: true, breakEvery: 50, sound: false,
    lang: q.get('lang') || ((navigator.language || 'ru').startsWith('ru') ? 'ru' : 'en'),
    hasApiKey: true, hasCalendar: true, hasStt: true, hasVosk: true,
    catColor: (q.get('color') as PublicSettings['catColor']) || 'ginger', speak: false,
    onboarded: q.has('onboarded'), contact: q.get('contact') ?? 'Маша',
    uiScale: Number(q.get('scale')) || 1, aiReady: q.has('ai'), locator: true, platform: q.get('platform') || 'win32',
  };
  const day = new Date();
  const at = (h: number, m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
  // тестовый «помощник»: два шага и успех
  let n = 0;
  const fake = [
    step('Нажми на зелёную трубку внизу экрана', { x: 360, y: 300, w: 60, h: 60 }),
    step('Теперь нажми на нужное имя в списке', { x: 900, y: 120, w: 220, h: 48 }),
    { ...step('Ура! Звонок пошёл!', null, 'done'), skill: 'Позвонить по видео' },
  ];
  return {
    setIgnoreMouse() {},
    getCursor: async () => null,
    getSettings: async () => s,
    saveSettings: async (next) => Object.assign(s, next),
    chat: async (t) => ({ reply: `Мяу! (тестовый режим) Ты написал: ${t}`, actions: [] }),
    resetChat: async () => true,
    addReminder: async (minutes, text, kind) => {
      const r = { id: String(Math.random()), at: Date.now() + minutes * 60000, text, kind };
      list.push(r);
      return r;
    },
    listReminders: async () => list,
    cancelReminder: async (id) => { list = list.filter((r) => r.id !== id); return true; },
    listCalendar: async () => ({
      connected: true,
      error: '',
      events: [
        { id: '1', title: 'Стендап', start: at(10, 0), end: at(10, 30), allDay: false, location: '' },
        { id: '2', title: 'Обед с командой', start: at(13, 0), end: at(14, 0), allDay: false, location: '' },
      ].filter((e) => e.end > Date.now()),
    }),
    simplifyExplanation: async (text) => ({ text }),
    guideLook: async ({ mode }) => {
      await new Promise((r) => setTimeout(r, 700));
      if (mode === 'confused') {
        return { ...step('Нажми на стрелку влево вверху', { x: 20, y: 20, w: 40, h: 40 }, 'explain'), explain: 'Сейчас открыт браузер, страница новостей.' };
      }
      n = mode === 'start' ? 0 : n + 1;
      return fake[Math.min(n, fake.length - 1)]!;
    },
    guideWatch() {},
    guideUnwatch() {},
    // тестовый «рабочий стол»: панель задач с WhatsApp
    locate: async (query) => {
      const desk = window.__desk ??= {
        top: { title: 'Рабочий стол', proc: 'explorer', close: { x: 1180, y: 8, w: 40, h: 30 } },
        items: { taskbar: [item('WhatsApp', 600, 680, 40, 40)] },
      };
      if (query.op === 'top' || query.op === 'window') return { win: desk.top };
      if (query.op === 'drives') return { drives: [] };
      if (query.op === 'volume') return { volume: desk.volume ?? 0.3, muted: false };
      const items = (desk.items[query.scope ?? ''] || []).filter((it) => !query.name || new RegExp(query.name, 'i').test(it.name));
      return { items };
    },
    filesAction: async ({ op }) => (op === 'access' ? { trusted: true } : { ok: true }),
    openUri: async () => true,
    openDrive: async () => true,
    transcribe: async () => ({ text: 'Хочу позвонить по видео' }),
    askMic: async () => true,
    savePostcard: async () => ({ saved: true }),
    addSkill: async (name) => {
      s.skills = [...s.skills.filter((x) => x.name !== name), { name, at: Date.now() }];
      return s.skills;
    },
    hide() {},
    quit() {},
    on(ch, cb) { handlers[ch] = cb as (data: never) => void; },
  };
}
