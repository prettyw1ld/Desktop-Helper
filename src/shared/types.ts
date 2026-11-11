// Данные, которые ходят между главным процессом и окном кота.

export type CatColor = 'white' | 'ginger' | 'black';
export type Provider = 'claude' | 'groq' | 'deepseek' | 'qwen' | 'openrouter' | 'openai' | 'ollama';
export type VoiceMode = 'offline' | 'whisper';

export interface Skill { name: string; at: number }

export interface Settings {
  lang: string;              // '' = по языку системы
  provider: Provider;
  aiChosen: boolean;         // человек сам выбрал модель в настройках (тогда team.json её не перебивает)
  aiUrl: string;             // адрес OpenAI-совместимого сервиса (для provider: openai)
  groqKey: string;           // ключи сервисов с готовыми настройками: у каждого свой,
  deepseekKey: string;       // чтобы переключаться между ними без ввода заново
  qwenKey: string;
  apiKey: string;            // ключ остальных: Claude, OpenRouter, свой адрес
  model: string;
  ollamaUrl: string;
  ollamaModel: string;
  calendarUrl: string;       // секретный iCal-адрес Google Календаря
  calendarBefore: number;    // за сколько минут предупреждать о встрече
  userName: string;
  size: number;              // размер кота
  uiScale: number;           // масштаб окон и подсказок, 0.7–1.4
  windows: boolean;          // гулять по краям окон
  sound: boolean;
  volume: number;
  breakEvery: number;        // минут между напоминаниями о перерыве, 0 = выключено
  chatter: boolean;          // кот сам что-то говорит без спроса
  speed: number;             // множитель скорости ходьбы
  autostart: boolean;        // запускаться вместе с компьютером
  autostartChosen: boolean;  // человек сам выбрал автозапуск (тогда не трогаем его выбор)
  catColor: CatColor;
  speak: boolean;            // читать подсказки вслух
  voiceRate: number;
  visionModel: string;       // модель Ollama с зрением; пусто = ollamaModel
  sttUrl: string;            // Whisper-совместимый сервис для голоса
  sttKey: string;
  sttModel: string;
  tasks: string[];           // свои кнопки-задачи; пусто = стандартные
  skills: Skill[];           // «Что я уже умею»
  onboarded: boolean;        // пройден ли тренажёр мыши при первом запуске
  contact: string;           // кому чаще всего звонят (для урока «Позвонить»)
  voice: VoiceMode;          // offline = Vosk в самом приложении, whisper = сервис по ключу
  trustedRemote: string[];   // программы удалённого доступа, про которые человек сказал «это свои»
  shotConsent: boolean;      // человек разрешил отправлять снимок экрана ИИ
  glass: boolean;            // полупрозрачная рамка у окон (текст всё равно на сплошном фоне)
}

export type SecretKey = 'apiKey' | 'calendarUrl' | 'sttKey' | 'groqKey' | 'deepseekKey' | 'qwenKey';

/** Модели, которые можно выбрать в настройках, и где лежит ключ каждой. */
export const PROVIDER_KEY = { groq: 'groqKey', deepseek: 'deepseekKey', qwen: 'qwenKey' } as const;
export type KeyedProvider = keyof typeof PROVIDER_KEY;
export const isKeyed = (p: string): p is KeyedProvider => p in PROVIDER_KEY;

/** Ключ, с которым идти к выбранному (или указанному) сервису. */
export function aiKey(s: Pick<Settings, 'provider' | 'apiKey' | 'groqKey' | 'deepseekKey' | 'qwenKey'>, provider: string = s.provider): string {
  return isKeyed(provider) ? s[PROVIDER_KEY[provider]] : s.apiKey;
}

/** Настройки, которые видит окно: без секретов, только признаки, что они заданы. */
export interface PublicSettings extends Omit<Settings, SecretKey> {
  hasApiKey: boolean;
  hasCalendar: boolean;
  hasStt: boolean;
  hasVosk: boolean;
  aiReady: boolean;
  teamKey: boolean;
  keys: Record<KeyedProvider, boolean>;  // у каких моделей из настроек есть ключ
  locator: boolean;
  platform: string;
}

export interface ErrorReply { error: string }
export const isError = (r: unknown): r is ErrorReply =>
  typeof r === 'object' && r !== null && typeof (r as ErrorReply).error === 'string' && !!(r as ErrorReply).error;

export interface Rect { x: number; y: number; w: number; h: number }

// ---------- Напоминания и календарь ----------
export type ReminderKind = 'reminder' | 'focus';
export interface Reminder { id: string; at: number; text: string; kind: ReminderKind }

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
}
export interface CalendarList { connected: boolean; error: string; events: CalendarEvent[] }
export interface CalendarSoon extends CalendarEvent { min: number; text: string }

// ---------- Помощник с ИИ ----------
export type LookMode = 'start' | 'check' | 'confused' | 'inspect' | 'practice';
export type LookStatus = 'step' | 'done' | 'not_found' | 'explain' | 'danger';

export interface LookRequest {
  mode: LookMode;
  goal?: string;
  history?: string[];
  selection?: Rect;
  previousSummary?: string;
  plan?: string[];      // путь к цели, который ИИ продумал на первом шаге
}

export interface LookResult {
  status: LookStatus;
  screenSummary: string;
  whatChanged: string;
  say: string;
  explain: string;
  skill: string;
  practiceGoal: string;
  target: Rect | null;  // в координатах окна кота
  snapped?: boolean;    // место уточнено через «доступность» системы, а не только догадка ИИ
  plan?: string[];      // весь путь к цели (на первом шаге или если путь поменялся)
  stepIndex?: number;   // какой это шаг плана, с 1; 0 — неизвестно
}

/** show: цель, которую кот покажет на экране по шагам вместо текстового ответа. */
export interface ChatResult { reply: string; actions: string[]; show?: string }

// ---------- Поиск кнопок через «доступность» ----------
export type LocateOp = 'find' | 'top' | 'window' | 'drives' | 'volume' | 'list' | 'shot' | 'grid';

export interface LocateQuery {
  op: LocateOp;
  scope?: string;       // taskbar | top | start | popup | desktop (значки рабочего стола Windows) | proc:<регулярка>
  name?: string;        // регулярка
  types?: string[];     // Button, Edit, ListItem…
  enabled?: boolean;
  firstWindow?: boolean;
  budget?: number;      // list: сколько миллисекунд можно искать
  skipProc?: string;    // list: регулярка программ, чьи окна не обходить
  width?: number;       // shot, grid: ширина картинки
  height?: number;      // grid: высота
}

export interface LocateItem extends Rect {
  name: string;
  type: string;
  focused: boolean;
  enabled: boolean;
  proc: string;
  area?: string;        // list: taskbar | popup | window | desktop
}

export interface LocateWindow {
  title: string;
  proc: string;
  folder?: string;
  rect?: Rect | null;
  close?: Rect | null;
}

export interface Drive { letter: string; label: string }

export interface LocateResult {
  items?: LocateItem[];
  win?: LocateWindow | null;
  drives?: Drive[];
  volume?: number;
  muted?: boolean;
  error?: string;
  jpeg?: string;        // shot: снимок экрана, base64
  grid?: string;        // grid: маленький снимок BGRA, base64 (следим за изменениями экрана)
  w?: number;           // shot, grid: размер картинки
  h?: number;
  sw?: number;          // shot: размер экрана в пикселях
  sh?: number;
}

// ---------- Уроки про файлы ----------
export type FilePlace = 'downloads' | 'documents' | 'practice';
export interface FilesRequest { op: 'access' | 'permissions' | 'open' | 'choose'; place?: FilePlace }
export interface FilesResult { trusted?: boolean; ok?: boolean; canceled?: boolean; error?: string }

/** Окно другой программы: [id, x, y, w, h] в координатах окна кота. */
export type WinRect = [id: number, x: number, y: number, w: number, h: number];


/** События из главного процесса в окно кота. */
export interface PushikEvents {
  'reminder': Reminder;
  'reminders-changed': Reminder[];
  'open': string;
  'settings-changed': PublicSettings;
  'calendar-soon': CalendarSoon;
  'calendar-changed': undefined;
  'windows': WinRect[];
  'screen-changed': undefined;
  'ai-wait': number;
  'work-area': Rect;   // где пол и стены для кота внутри окна (без панели задач)
  'remote-app': string; // запустилась программа удалённого доступа (защита от мошенников)
}
export type PushikEvent = keyof PushikEvents;
export const PUSHIK_EVENTS: PushikEvent[] = [
  'reminder', 'reminders-changed', 'open', 'settings-changed', 'calendar-soon', 'calendar-changed',
  'windows', 'screen-changed', 'ai-wait', 'work-area', 'remote-app',
];

/** Мост preload.ts: что окно кота может попросить у главного процесса. */
export interface PushikApi {
  setIgnoreMouse(ignore: boolean): void;
  getCursor(): Promise<{ x: number; y: number } | null>;
  getSettings(): Promise<PublicSettings>;
  saveSettings(s: Partial<Settings>): Promise<PublicSettings>;
  chat(text: string): Promise<ChatResult | ErrorReply>;
  resetChat(): Promise<boolean>;
  addReminder(minutes: number, text: string, kind: ReminderKind): Promise<Reminder>;
  listReminders(): Promise<Reminder[]>;
  cancelReminder(id: string): Promise<boolean>;
  listCalendar(days: number): Promise<CalendarList>;
  quit(): void;
  hide(): void;
  simplifyExplanation(text: string): Promise<{ text: string } | ErrorReply>;
  guideLook(req: LookRequest): Promise<LookResult | ErrorReply>;
  guideWatch(masks: Rect[]): void;
  guideUnwatch(): void;
  transcribe(audio: ArrayBuffer, mime: string): Promise<{ text: string } | ErrorReply>;
  askMic(): Promise<boolean>;
  addSkill(name: string): Promise<Skill[]>;
  locate(q: LocateQuery): Promise<LocateResult>;
  openUri(uri: string): Promise<boolean>;
  filesAction(req: FilesRequest): Promise<FilesResult>;
  openDrive(letter: string): Promise<boolean>;
  on<E extends PushikEvent>(channel: E, cb: (data: PushikEvents[E]) => void): void;
}
