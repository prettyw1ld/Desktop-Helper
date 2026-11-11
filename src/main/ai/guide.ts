// Помощник для новичка: снимок экрана → модель с зрением → куда показать лапкой.
// Снимок живёт только в памяти и на диск не пишется.
import { desktopCapturer, nativeImage, screen, type BrowserWindow, type Display, type NativeImage } from 'electron';
import type { LookMode, LookRequest, LookResult, LookStatus, Rect, Settings } from '../../shared/types';
import { aiError, fetchAI, fetchAIRetry, readError } from './http';
import { CLAUDE_URL, cleanReply, extraFor, pickModel, resolve } from './llm';
import { cropSelection, formatContext, inspectPrompt, INSPECT_SYSTEM, scrub, windowView } from './screen-region';
import { clickFact } from './inspect-text';
import { boxUnits, cleanPlan, formatMarks, pickMark, refineCrop, stepOf, withTaskbar, type ElementHint, type Mark } from './show';
import { guideLog } from './guide-log';
import { toFrame } from '../geometry';
import * as locate from '../system/locate';
import type { InspectContext, LocateItem } from '../../shared/types';

const SHOT_W = 1024; // ширина снимка для модели (меньше = быстрее ответ)
const STATUSES: LookStatus[] = ['step', 'done', 'not_found', 'explain', 'danger'];

// Ответ модели всегда в одном формате, через принудительный вызов инструмента.
const STEP_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: STATUSES,
      description: 'step = next action to show; done = the goal is reached; not_found = cannot find a way on this screen; explain = answer to "I am lost"; danger = something unsafe is on screen',
    },
    observedText: { type: 'string', description: 'For inspect only: exact text visible in the cropped selection, empty if unreadable.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence in identifying the selected element from the crop alone.' },
    screenSummary: { type: 'string', description: 'One factual sentence describing the visible app and current state for the next comparison. No sensitive values.' },
    whatChanged: { type: 'string', description: 'Only for check: explain the observed result since previousSummary in 1-2 simple sentences. If uncertain or unchanged, state this clearly. Never infer success merely from a click.' },
    say: { type: 'string', description: 'What the cat says. ONE action, max 12 words, plain words, no jargon.' },
    explain: { type: 'string', description: 'Only for explain/danger: 1-2 short sentences about what is on the screen and how to go back.' },
    target: {
      type: 'object',
      description: 'Box around the thing to press, in the coordinate system given in the request. Omit if there is nothing to point at.',
      properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
      required: ['x', 'y', 'w', 'h'],
    },
    plan: {
      type: 'array',
      items: { type: 'string' },
      description: 'For start: think through the WHOLE route from the current screen to the goal, 2-10 steps, one physical action each, '
        + 'max 8 words, plain words (e.g. ["Нажми «Пуск»", "Напиши «часы»", "Открой «Часы»", "Нажми «Таймер»", "Нажми «Старт»"]). '
        + 'For check: send it again only if the route must change; otherwise omit.',
    },
    stepIndex: { type: 'number', description: 'Which plan step (1-based) the current "say" is.' },
    elementId: { type: 'number', description: 'If the thing to press is in the numbered list of screen elements, its number. This is the most precise way to point: prefer it over "target".' },
    element: {
      type: 'object',
      description: 'The thing in "target", so the computer can find it exactly. Omit if there is no target.',
      properties: {
        name: { type: 'string', description: 'Its exact visible text or label as written on the screen, e.g. "Таймер". Empty for pictures without text.' },
        type: { type: 'string', enum: ['button', 'tab', 'text field', 'menu item', 'list item', 'icon', 'link', 'checkbox', 'other'] },
        area: { type: 'string', enum: ['taskbar', 'start menu', 'window', 'popup', 'desktop'] },
      },
    },
    opened: {
      type: 'string',
      description: 'For check: if the last action OPENED a menu, list, panel or window that is visible now, explain it to a beginner in 2-4 short lines: '
        + 'first what this menu/window is for (one sentence), then the 3 most useful items as "«Name» — what it does" using the names exactly as written on the screen (add the shortcut if shown). '
        + 'For more: the next portion of detail in the same "«Name» — what it does" format, 3-6 lines, only items not explained yet. Empty if nothing new opened.',
    },
    hasMore: { type: 'boolean', description: 'For check/more with "opened": true if there are still useful items or details to explain at the next level.' },
    details: { type: 'string', description: 'For inspect only: 2-4 short sentences for the «Подробнее» button (how to use, shortcut if known, how to undo, warning if risky). Empty if nothing to add.' },
    appName: { type: 'string', description: 'For inspect only: the program name, ONLY from System facts or clearly written on the screen; empty otherwise.' },
    practiceGoal: { type: 'string', description: 'For inspect explanations: one safe, specific, reversible beginner exercise with the selected element, phrased as a verifiable goal. No delete, payment, send, installation, credentials, or configuration changes. Empty if no safe exercise exists.' },
    skill: { type: 'string', description: 'Only for done: the learned skill in 2-5 words, e.g. "Позвонить по видео".' },
  },
  required: ['status', 'say'],
};

/** Сырой ответ модели (до проверки). */
interface StepAnswer {
  status?: string;
  details?: string;
  opened?: unknown;
  hasMore?: unknown;
  appName?: string;
  observedText?: string;
  confidence?: string;
  screenSummary?: string;
  whatChanged?: string;
  say?: string;
  explain?: string;
  target?: Partial<Rect>;
  practiceGoal?: unknown;
  skill?: string;
  plan?: unknown;
  stepIndex?: unknown;
  element?: ElementHint;
  elementId?: unknown;
}

export function systemPrompt(lang: string, platform: NodeJS.Platform): string {
  const os = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
  return [
    `You are Pushik, a kind pixel cat who lives on the desktop (${os}) and teaches a complete computer beginner`,
    '(for example a 68-year-old grandmother) to do things on the computer BY THEMSELVES.',
    'You get a screenshot of the screen and the person\'s goal. You never click for them: you point with your paw.',
    'Rules for "say":',
    '- exactly ONE physical action per hint, at most 12 words;',
    '- no computer terms: say "the cross in the top right corner", not "close the window"; say "the round blue picture", not "the icon";',
    '- describe things by colour, shape, picture and where they are on the screen;',
    '- warm and calm, like talking to a grandmother; you may start with "Мур!" rarely;',
    '- never ask for passwords, card numbers or codes from SMS; never suggest installing unknown programs.',
    'Pointing: if the request lists screen elements with numbers, find the thing to press there and give its number in "elementId": that is exact.',
    'Rules for "target": the box (x, y, w, h, x/y = top-left corner, in the coordinate system given in the request) must tightly cover the thing to press.',
    'Always give "target" too, even with elementId: it is the fallback.',
    'Prefer a slightly bigger box over missing the element. Ignore any cartoon cat, speech bubble or yellow ring on the screenshot: that is you.',
    'If the screen shows a bank card form, a download of an .exe from an unknown site or a scary "your PC is infected" banner, answer status "danger" and tell the person not to type anything and how to close it.',
    'If the goal is already reached on this screen, answer "done" with a short happy phrase and the skill name.',
    'If the hint needs typing, tell what to type in quotes, e.g. Напиши «погода».',
    lang !== 'en' ? 'Always answer in Russian.' : 'Always answer in English.',
  ].join('\n');
}

function planText(plan: string[] = []): string {
  return plan.length ? `Planned route:\n${plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n` : '';
}

function userText({ mode, goal = '', history = [], previousSummary, plan = [], level = 1 }: LookRequest): string {
  if (mode === 'practice') {
    return `The user chose to practice this goal themselves: ${goal}. Give exactly ONE safe physical action to begin, with status step and its target. `
      + 'Do not claim success before they attempt it. Never perform the action yourself. If the goal is already achieved, ask them to choose another element using status not_found. '
      + 'Do not suggest deletion, sending messages, purchases, installation, entering credentials, or changing configuration.';
  }
  const done = history.length ? `Hints already given (oldest first):\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : 'No hints yet.';
  if (mode === 'confused') {
    return `The person pressed "I am lost". ${goal ? `Their goal was: "${goal}". ` : ''}Look at the screen and answer with status "explain": `
      + 'in "explain" say simply what is open now, and in "say" give ONE action to go back or close it, with "target" on that button if you see it.';
  }
  if (mode === 'check') {
    return `Goal: "${goal}".\n${done}\nThe person says they did the last hint (or the screen changed). Look at the new screenshot. `
      + `Previous visible state: ${previousSummary || 'unknown; do not invent a comparison'}. Fill whatChanged using visible evidence; acknowledge uncertainty. `
      + 'If the goal is reached, answer "done". If the last step worked, give the NEXT step. If it did not work, kindly show the same thing again in other words.\n'
      + 'If the last step opened a menu, list, panel or window, fill "opened": the person wants to understand what is inside. '
      + 'Never tell them to close what just opened (Escape, cross) unless the goal needs it.\n'
      + `${planText(plan)}Follow the planned route and set stepIndex. If the screen shows the route must change (other window, step already done), send a new full plan.`;
  }
  if (mode === 'more') {
    const told = history.length
      ? `What was already explained to them (do not repeat it):\n${history.map((h) => `- ${h}`).join('\n')}\nThey pressed «Подробнее» (level ${level}). `
        + 'Continue in "opened": the next 3-6 useful items not explained yet, as "«Name» — what it does, when a beginner would use it", one per line. '
        + 'At level 3 and later you may add one tip how to use it faster. If it is no longer open, continue from what was explained. '
      : 'They have just pressed a button and want to understand what it opened. Your ONLY task now is to fill "opened" in Russian: '
        + 'line 1 — what this menu, list, panel or window is for (one simple sentence); then the 3 most useful items, one per line, as "«Name» — what it does". '
        + 'If NO menu, list, panel or new window is open on the screenshot, leave "opened" empty. ';
    return `The person is learning: "${goal}". Look at the menu, list, panel or window that is open on the screenshot. ${told}`
      + 'Item names exactly as written on the screen, shortcuts if shown. Do not give any action to do, do not tell them to close anything. '
      + 'Answer status "explain", "say" = a short title (max 6 words), set hasMore (true if items remain unexplained), '
      + 'and practiceGoal: one safe thing to try with these items (no delete, send, install, settings).';
  }
  return `Goal: "${goal}".\n${done}\nFirst think through the whole route from this screen to the goal and put it in "plan". `
    + 'If the needed app is not visible, the route starts from what IS visible (for example the Start button or search). '
    + 'Then show step 1 of the plan: "say", "target", "element", stepIndex 1.';
}

// ---------- Снимок экрана ----------
export interface Shot { image: NativeImage; w: number; h: number; display: Display }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function primarySource(sources: Electron.DesktopCapturerSource[], display: Display) {
  return sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
}

// overlay: окно кота. На время снимка его исключаем из захвата: человек кота видит, а ИИ нет.
// Раньше прятали прозрачностью, и на Windows прозрачное окно после этого уходило под браузер.
// Защиту сразу снимаем, чтобы кот был виден в записи экрана.
export async function capture(overlay: BrowserWindow | null, width = SHOT_W): Promise<Shot> {
  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh } = display.size;
  const w = Math.min(width, dw);
  const h = Math.round((dh * w) / dw);
  const ok = !!overlay && !overlay.isDestroyed() && overlay.isVisible();
  const fade = ok && process.platform === 'linux';
  if (ok && !fade) { overlay.setContentProtection(true); await sleep(60); }
  if (fade) { overlay.setOpacity(0); await sleep(90); }
  let sources: Electron.DesktopCapturerSource[] = [];
  let fast: NativeImage | null = null;
  try {
    // Windows: быстрый снимок через PowerShell (BitBlt). Снимок Electron на некоторых компьютерах идёт 2 с
    // и всё это время тормозит систему. Не вышло — берём снимок Electron.
    if (process.platform === 'win32') fast = await winShot(width);
    if (!fast) sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  } finally {
    if (ok && !overlay.isDestroyed()) {
      if (fade) overlay.setOpacity(1);
      else overlay.setContentProtection(false);
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
    }
  }
  if (fast) { const size = fast.getSize(); return { image: fast, w: size.width, h: size.height, display }; }
  const src = primarySource(sources, display);
  if (!src || src.thumbnail.isEmpty()) throw aiError('no screenshot', { code: 'noShot' });
  const size = src.thumbnail.getSize();
  return { image: src.thumbnail, w: size.width, h: size.height, display };
}

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

async function winShot(width: number): Promise<NativeImage | null> {
  const t = Date.now();
  const res = await withTimeout(locate.ask({ op: 'shot', width }), 4000, { error: 'timeout' });
  if (!res.jpeg) { guideLog('shot-fallback', { error: res.error ?? 'empty' }); return null; }
  const img = nativeImage.createFromBuffer(Buffer.from(res.jpeg, 'base64'));
  if (img.isEmpty()) { guideLog('shot-fallback', { error: 'bad image' }); return null; }
  guideLog('shot', { ms: Date.now() - t, w: res.w, h: res.h, screen: [res.sw, res.sh] });
  return img;
}

/** Маленький снимок для слежки за экраном: BGRA и размер. Windows — через PowerShell, иначе Electron. */
async function smallShot(display: Display, W: number): Promise<{ bmp: Buffer; w: number; h: number } | null> {
  const h = Math.round((display.size.height * W) / display.size.width);
  if (process.platform === 'win32') {
    const res = await withTimeout(locate.ask({ op: 'grid', width: W, height: h }), 3000, { error: 'timeout' });
    if (res.grid) return { bmp: Buffer.from(res.grid, 'base64'), w: W, h };
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: h } });
  const src = primarySource(sources, display);
  if (!src) return null;
  const size = src.thumbnail.getSize();
  return { bmp: src.thumbnail.toBitmap(), w: size.width, h: size.height };
}

// Перевод рамки из пикселей снимка в координаты окна кота (оно на всю рабочую область).
function toOverlay(box: Partial<Rect> | undefined, shot: Shot): Rect | null {
  if (!box) return null;
  const { x, y, w, h } = box;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const { display } = shot;
  // некоторые модели (Qwen) дают рамку в долях 0..1000 вместо пикселей снимка
  const normalized = boxUnits(box as Rect, shot.w, shot.h) === 'k';
  const kx = display.size.width / (normalized ? 1000 : shot.w);
  const ky = display.size.height / (normalized ? 1000 : shot.h);
  const r = { x: x! * kx + display.bounds.x, y: y! * ky + display.bounds.y, w: w! * kx, h: h! * ky };
  if (r.w < 4 || r.h < 4) return null;
  return toFrame(r, display.bounds);
}

// ---------- Элементы экрана от системы (Windows UI Automation) ----------
// Кнопки с точными прямоугольниками. ИИ выбирает номер, и кот показывает ровно в кнопку.
const MARKS_BUDGET = 900;
// Chromium и Electron: обход их окна через UI Automation включает у них тяжёлую «доступность»
const HEAVY_A11Y = '^(chrome|msedge|browser|opera|brave|vivaldi|firefox|Code|Cursor|Discord|Slack|Teams|ms-teams|Spotify|Obsidian|Notion|Figma|electron)$';

async function screenMarks(shot: Promise<Shot>): Promise<Mark[]> {
  if (process.platform !== 'win32') return [];
  // PowerShell один и отвечает по очереди: сначала снимок (кот на это время скрыт), потом список кнопок
  await shot;
  const res = await Promise.race([
    locate.ask({ op: 'list', budget: MARKS_BUDGET, skipProc: HEAVY_A11Y }),
    new Promise<{ items?: LocateItem[] }>((r) => setTimeout(() => r({}), MARKS_BUDGET + 1500)),
  ]);
  const items = withTaskbar(res.items ?? []);
  const info = res as { error?: string; ms?: number; skipped?: string };
  guideLog('marks', { items: items.length, psMs: info.ms ?? null, skipped: info.skipped || null, error: info.error ?? (res.items ? null : 'timeout') });
  if (!items.length) return [];
  const { display, w: sw, h: sh } = await shot;
  const marks: Mark[] = [];
  for (const it of items) {
    // UI Automation даёт настоящие пиксели экрана; переводим в точки (DIP), как у Electron
    const d = screen.screenToDipRect(null, { x: it.x, y: it.y, width: it.w, height: it.h });
    const k = sw / display.size.width;
    const inShot = { x: Math.round((d.x - display.bounds.x) * k), y: Math.round((d.y - display.bounds.y) * k), w: Math.round(d.width * k), h: Math.round(d.height * k) };
    if (inShot.x + inShot.w / 2 < 0 || inShot.y + inShot.h / 2 < 0 || inShot.x + inShot.w / 2 > sw || inShot.y + inShot.h / 2 > sh) continue;
    const overlay = toFrame({ x: d.x, y: d.y, w: d.width, h: d.height }, display.bounds);
    if (!overlay) continue;
    marks.push({ id: marks.length + 1, name: it.name, type: it.type, area: it.area || '', shot: inShot, overlay });
  }
  return marks;
}

// ---------- Модели ----------
interface ModelInput {
  apiKey: string;
  model: string;
  url: string;
  vision: string;
  ollamaUrl: string;
  ollamaModel: string;
  visionModel: string;
  system: string;
  text: string;
  jpeg: string;
  before?: string[];  // картинки перед основной (inspect: снимок окна с рамкой)
}

async function askClaude({ apiKey, model, system, text, jpeg, before = [] }: ModelInput): Promise<StepAnswer> {
  const res = await fetchAI(CLAUDE_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system,
      tools: [{ name: 'show_step', description: 'Show the person what to do next.', input_schema: STEP_SCHEMA }],
      tool_choice: { type: 'tool', name: 'show_step' },
      messages: [{
        role: 'user',
        content: [
          ...[...before, jpeg].map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
          { type: 'text', text },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json() as { content: { type: string; input?: StepAnswer }[] };
  const use = data.content.find((b) => b.type === 'tool_use');
  if (!use?.input) throw new Error('empty answer');
  return use.input;
}

// OpenAI-совместимые сервисы с зрением (Groq, DeepSeek, Qwen, OpenRouter …): ответ строго JSON
async function askOpenAI({ apiKey, url, vision, system, text, jpeg, before = [] }: ModelInput): Promise<StepAnswer> {
  const schema = JSON.stringify(STEP_SCHEMA);
  const model = await pickModel({ url, apiKey, want: vision, vision: true });
  const send = (strict: boolean) => fetchAIRetry(`${url}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      ...extraFor(model, url),
      ...(strict ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: `${system}\nAnswer ONLY with a JSON object matching this JSON schema: ${schema}` },
        // картинки перед текстом: так модели лучше понимают, к чему относится вопрос
        { role: 'user', content: [...[...before, jpeg].map((b64) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })), { type: 'text', text }] },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  let res = await send(true);
  // строгий JSON иногда не проходит проверку сервиса: тогда просим без него и вырезаем JSON сами
  if (res.status === 400) res = await send(false);
  if (!res.ok) throw await readError(res);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const raw = cleanReply(data.choices?.[0]?.message?.content) || '{}';
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) || '{}';
  return JSON.parse(json) as StepAnswer;
}

// Ollama: нужна модель с зрением (qwen2.5vl, llava, gemma3).
async function askOllama({ ollamaUrl, visionModel, ollamaModel, system, text, jpeg, before = [] }: ModelInput): Promise<StepAnswer> {
  let res: Response;
  try {
    res = await fetchAI(`${ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: visionModel || ollamaModel,
        stream: false,
        format: STEP_SCHEMA,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text, images: [...before, jpeg] }],
      }),
    });
  } catch {
    throw aiError('offline', { offline: true });
  }
  if (!res.ok) throw await readError(res);
  const msg = ((await res.json()) as { message?: { content?: string } }).message || {};
  return JSON.parse(String(msg.content || '{}').replace(/<think>[\s\S]*?<\/think>/g, '')) as StepAnswer;
}

// ---------- «Объясни, что это»: контекст окна ----------
/** Что говорит система о программе и элементе под выделением. Только Windows; не дольше 2.5 с. */
// ---------- Нажатие мышью во время подсказки ----------
// Что человек нажал, узнаём у системы сразу в момент нажатия: через секунду на этом месте может быть уже другое окно.
let lastClick: { at: number; ctx: Promise<InspectContext | null> } | null = null;

/** p — точка нажатия в координатах окна кота (оно начинается в углу основного экрана). */
export function noteClick(p: { x: number; y: number } | null): void {
  if (!p || process.platform !== 'win32') { lastClick = null; return; }
  const b = screen.getPrimaryDisplay().bounds;
  const px = screen.dipToScreenRect(null, { x: p.x + b.x - 4, y: p.y + b.y - 4, width: 8, height: 8 });
  const ctx = withTimeout(locate.ask({ op: 'context', x: px.x, y: px.y, w: px.width, h: px.height }), 2500, { error: 'timeout' })
    .then((res) => res.ctx ?? null)
    .catch(() => null);
  lastClick = { at: Date.now(), ctx };
}

async function clickText(click: LookRequest['click']): Promise<string> {
  if (!click) return '';
  const fresh = lastClick && Date.now() - lastClick.at < 6000 ? lastClick : null;
  lastClick = null;
  const ctx = fresh ? await withTimeout(fresh.ctx, 1500, null) : null;
  const text = clickFact(ctx, !!click.onTarget);
  guideLog('click', { onTarget: !!click.onTarget, element: ctx?.element ?? null, app: ctx?.app ?? '' });
  return text;
}

async function inspectContext(shot: Shot, selection: Rect | undefined): Promise<InspectContext | null> {
  if (process.platform !== 'win32' || !selection) return null;
  const b = shot.display.bounds;
  // выделение в точках окна кота → настоящие пиксели экрана, как у UI Automation
  const px = screen.dipToScreenRect(null, { x: selection.x + b.x, y: selection.y + b.y, width: selection.w, height: selection.h });
  const res = await withTimeout(locate.ask({ op: 'context', x: px.x, y: px.y, w: px.width, h: px.height }), 2500, { error: 'timeout' });
  if (!res.ctx) guideLog('inspect-context', { error: res.error ?? 'empty', ms: res.ms ?? null });
  return res.ctx ?? null;
}

/** Снимок окна (или экрана) с рамкой вокруг выделения; null, если не получилось. */
function contextView(shot: Shot, selection: Rect | undefined, ctx: InspectContext | null): NativeImage | null {
  try {
    let win: Electron.Rectangle | null = null;
    if (ctx?.rect) {
      const d = screen.screenToDipRect(null, { x: ctx.rect.x, y: ctx.rect.y, width: ctx.rect.w, height: ctx.rect.h });
      const k = shot.w / shot.display.size.width;
      win = { x: Math.round((d.x - shot.display.bounds.x) * k), y: Math.round((d.y - shot.display.bounds.y) * k), width: Math.round(d.width * k), height: Math.round(d.height * k) };
    }
    return windowView(shot, selection, win);
  } catch (e) {
    guideLog('inspect-view', { error: String(e) });
    return null;
  }
}

/** Названия программ, которые модель может назвать: от системы и из прочитанной подписи. */
function checkInspect(out: StepAnswer, ctx: InspectContext | null): StepAnswer {
  const sysApp = scrub(ctx?.app || '', 60);
  const said = scrub(out.appName || '', 60);
  // программу называет система; если системе неизвестно — только если название видно в подписи
  const visible = said && [out.observedText, ctx?.title].some((t) => String(t ?? '').toLowerCase().includes(said.toLowerCase()));
  const app = sysApp || (visible ? said : '');
  const res = { ...out, appName: app };
  if (said && !app) {
    // модель назвала программу, которую не видно и о которой система не говорила: убираем название из ответа
    const drop = (s?: string) => (s ? s.split(said).join('этой программе').trim() : s);
    res.say = drop(res.say);
    res.explain = drop(res.explain);
    res.details = drop(res.details);
  }
  return res;
}

// «Объясни, что это» с низкой уверенностью: не гадаем, а просим выделить точнее
function unsureInspect(out: StepAnswer): StepAnswer {
  return {
    ...out,
    status: 'explain',
    say: out.observedText ? `Элемент «${String(out.observedText).slice(0, 120)}»` : 'Не могу уверенно распознать элемент',
    explain: 'Я не совсем уверен, что это. Обведи значок вместе с названием чуть точнее, чтобы я не подсказал наугад.',
    details: '',
    practiceGoal: '',
  };
}

const CHECK_MODES: LookMode[] = ['check'];

// ---------- Уточнение по увеличенному кусочку экрана ----------
// Когда системного списка кнопок нет (меню «Пуск», страницы в браузере), рамка ИИ по снимку 1024 px
// часто уезжает. Тогда вырезаем область вокруг догадки из снимка в полном размере и просим ИИ
// показать кнопку ещё раз уже на увеличенной картинке: там она в 2–4 раза крупнее.
const REFINE_SYSTEM = 'You find one thing on a zoomed-in crop of a computer screen and return its box. '
  + 'Answer with status "step", "say" = the name of the thing, and "target" = a tight box around it in crop pixels '
  + '(x, y = top-left corner). If the thing is not in the crop, omit "target". Ignore any cartoon cat or speech bubble.';

async function refine(fn: (i: ModelInput) => Promise<StepAnswer>, base: ModelInput, overlay: BrowserWindow | null,
  shot: Shot, box: Rect, what: string): Promise<Rect | null> {
  const full = await capture(overlay, 4096);
  const k = full.w / shot.w;
  const crop = refineCrop({ x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k }, full.w, full.h);
  const img = full.image.crop({ x: crop.x, y: crop.y, width: crop.w, height: crop.h });
  const out = await fn({
    ...base,
    system: REFINE_SYSTEM,
    text: `Find: ${what}\nCrop size: ${crop.w}x${crop.h} pixels. Coordinates for "target": crop pixels.`,
    jpeg: img.toJPEG(92).toString('base64'),
  });
  const t = out.target;
  if (!t || ![t.x, t.y, t.w, t.h].every(Number.isFinite)) return null;
  const units = boxUnits(t as Rect, crop.w, crop.h);
  const kx = units === 'k' ? crop.w / 1000 : 1;
  const ky = units === 'k' ? crop.h / 1000 : 1;
  const inFull = { x: crop.x + t.x! * kx, y: crop.y + t.y! * ky, w: t.w! * kx, h: t.h! * ky };
  if (inFull.w < 3 || inFull.h < 3) return null;
  // обратно в пиксели маленького снимка, а дальше как обычно
  return { x: inFull.x / k, y: inFull.y / k, w: inFull.w / k, h: inFull.h / k };
}

/** Посмотреть на экран и решить, что сказать и куда показать. target — в координатах окна кота. */
export async function look(req: LookRequest & { settings: Settings; overlay: BrowserWindow | null }): Promise<LookResult> {
  const { mode, selection, settings, overlay } = req;
  const inspect = mode === 'inspect';
  // снимок и список кнопок от системы делаем одновременно: так быстрее и они совпадают
  const t0 = Date.now();
  const more = mode === 'more';
  // «Подробнее» про открытое меню: снимок покрупнее, чтобы прочесть мелкие пункты; лапкой не показываем
  const shotP = capture(overlay, inspect ? 4096 : more ? 1920 : SHOT_W);
  const marksP = inspect || more ? Promise.resolve([] as Mark[]) : screenMarks(shotP).catch((e: unknown) => { guideLog('marks-error', { error: String(e) }); return [] as Mark[]; });
  const shot = await shotP;
  const tShot = Date.now() - t0;
  const marks = await marksP;
  const tMarks = Date.now() - t0;
  const image = inspect ? cropSelection(shot, selection) : shot.image;
  // «Объясни, что это»: ещё снимок всего окна с рамкой вокруг выделения и сведения от системы
  const tCtx = Date.now();
  const ctx = inspect ? await inspectContext(shot, selection) : null;
  const view = inspect ? contextView(shot, selection, ctx) : null;
  const facts = formatContext(ctx);
  const msCtx = Date.now() - tCtx;
  const system = inspect ? INSPECT_SYSTEM : systemPrompt(settings.lang, process.platform);
  const size = image.getSize();
  const r = resolve(settings);
  const coords = `Coordinates for "target": screenshot pixels. Image size: ${size.width}x${size.height} pixels.`;
  const clicked = mode === 'check' ? await clickText(req.click) : '';
  const text = inspect
    ? inspectPrompt(facts, !!view)
    : `${userText(req)}\n${clicked ? `${clicked}\n` : ''}${coords}\n${formatMarks(marks)}`;

  const input: ModelInput = {
    ...settings,
    url: r.kind === 'openai' ? r.url : '',
    vision: r.kind === 'openai' ? r.vision : '',
    system,
    text,
    jpeg: image.toJPEG(90).toString('base64'),
    before: view ? [view.toJPEG(82).toString('base64')] : [],
  };
  const fn = r.kind === 'ollama' ? askOllama : r.kind === 'openai' ? askOpenAI : askClaude;
  const tAsk = Date.now();
  let out: StepAnswer;
  try {
    out = await fn(input);
  } catch (e) {
    // модель не принимает две картинки: спрашиваем как раньше, по одной вырезке и сведениям от системы
    if (!input.before?.length) throw e;
    guideLog('inspect-one-image', { error: String(e) });
    out = await fn({ ...input, before: [], text: inspectPrompt(facts, false) });
  }
  if (inspect) out = checkInspect(out, ctx);
  if (inspect) guideLog('inspect', { ms: msCtx, facts, app: out.appName ?? '', confidence: out.confidence ?? '', view: view?.getSize() ?? null });
  const tModel = Date.now() - tAsk;
  if (inspect && (!out.confidence || out.confidence === 'low')) out = unsureInspect(out);
  const plan = inspect ? [] : cleanPlan(out.plan);
  let guess = inspect || more ? null : toOverlay(out.target, shot);
  // точнее всего — номер элемента из списка системы; иначе ищем названную кнопку рядом с рамкой ИИ
  const mark = inspect || out.status === 'done' ? null : pickMark(marks, out.elementId, out.element?.name, guess);
  // кнопки нет в списке системы: уточняем рамку ИИ по увеличенному кусочку экрана
  let refined: Rect | null = null;
  let tRefine = 0;
  if (!mark && guess && out.target && out.status !== 'done' && !inspect && !more) {
    const tr = Date.now();
    const raw = out.target as Rect;
    const inShot = boxUnits(raw, shot.w, shot.h) === 'k'
      ? { x: raw.x * shot.w / 1000, y: raw.y * shot.h / 1000, w: raw.w * shot.w / 1000, h: raw.h * shot.h / 1000 }
      : raw;
    const what = [out.element?.name && `"${out.element.name}"`, out.element?.type, `(hint: ${out.say})`].filter(Boolean).join(' ');
    refined = await refine(fn, input, overlay, shot, inShot, what).catch((e: unknown) => { guideLog('refine-error', { error: String(e) }); return null; });
    tRefine = Date.now() - tr;
    if (refined) guess = toOverlay(refined, shot) ?? guess;
  }
  const target = mark ? mark.overlay : guess;
  const snapped = !!mark;
  const d = shot.display;
  guideLog('look', {
    mode, ms: { shot: tShot, marks: tMarks, model: tModel, refine: tRefine },
    display: { size: d.size, scale: d.scaleFactor, work: d.workArea, shot: [shot.w, shot.h] },
    marks: marks.length, taskbarMarks: marks.filter((m) => m.area === 'taskbar').length,
    status: out.status, say: String(out.say || '').slice(0, 80), opened: typeof out.opened === 'string' ? out.opened.length : 0,
    rawTarget: out.target, elementId: out.elementId ?? null, element: out.element ?? null,
    picked: mark ? { id: mark.id, name: mark.name, type: mark.type } : null, refined, target,
  });
  return {
    status: STATUSES.includes(out.status as LookStatus) ? out.status as LookStatus : 'step',
    screenSummary: String(out.screenSummary || '').slice(0, 1000),
    whatChanged: CHECK_MODES.includes(mode) ? String(out.whatChanged || '').slice(0, 1000) : '',
    say: String(out.say || '').trim(),
    explain: out.explain ? String(out.explain).trim() : '',
    skill: out.skill ? String(out.skill).trim() : '',
    practiceGoal: typeof out.practiceGoal === 'string' ? out.practiceGoal.trim().slice(0, 500) : '',
    details: inspect && out.details ? String(out.details).trim().slice(0, 900) : '',
    opened: (mode === 'check' || more) && typeof out.opened === 'string' ? out.opened.trim().slice(0, 1200) : '',
    hasMore: out.hasMore !== false,
    target,
    snapped,
    plan,
    stepIndex: stepOf(out.stepIndex, plan.length ? plan : req.plan ?? []),
  };
}

// ---------- Слежка за изменениями экрана ----------
// Маленькие снимки раз в 2 с (снимок экрана в Windows недешёвый: чаще — и всё начинает подтормаживать).
// Через 90 с без изменений перестаём следить: дальше человек нажмёт «Сделал». Сравниваем с первым, пропуская места, где нарисован сам кот
// (masks в координатах окна кота). Если экран заметно поменялся, зовём onChange.
let watchTimer: NodeJS.Timeout | null = null;

export function watch({ masks = [], onChange }: { masks?: Rect[]; onChange: () => void }): void {
  unwatch();
  let base: Buffer | null = null;
  let busy = false;
  const W = 160;
  const until = Date.now() + 90_000;
  let slowUntil = 0;
  watchTimer = setInterval(async () => {
    if (busy || Date.now() < slowUntil) return;
    if (Date.now() > until) { unwatch(); return; }
    const started = Date.now();
    busy = true;
    try {
      const display = screen.getPrimaryDisplay();
      const small = await smallShot(display, W);
      if (!small || !watchTimer) return;
      const { bmp } = small;
      const size = { width: small.w, height: small.h };
      const k = size.width / display.size.width;
      const offX = 0; // окно кота начинается в углу экрана
      const offY = 0;
      const masked = (x: number, y: number) => masks.some((m) => {
        const mx = (m.x + offX) * k;
        const my = (m.y + offY) * k;
        return x >= mx - 2 && x <= mx + m.w * k + 2 && y >= my - 2 && y <= my + m.h * k + 2;
      });
      // снимок экрана дорогой на этом компьютере: смотрим реже, чтобы не тормозить систему
      const took = Date.now() - started;
      if (took > 300) { slowUntil = Date.now() + took * 8; guideLog('watch-slow', { ms: took }); }
      if (!base) { base = bmp; return; }
      let diff = 0;
      let n = 0;
      for (let y = 0; y < size.height; y += 2) {
        for (let x = 0; x < size.width; x += 2) {
          if (masked(x, y)) continue;
          const i = (y * size.width + x) * 4;
          const d = Math.abs(bmp[i]! - base[i]!) + Math.abs(bmp[i + 1]! - base[i + 1]!) + Math.abs(bmp[i + 2]! - base[i + 2]!);
          if (d > 60) diff++;
          n++;
        }
      }
      // поменялось больше 3% экрана: открылось окно, страница и т.п.
      if (n && diff / n > 0.03) { unwatch(); onChange(); }
    } catch { /* нет доступа к экрану: просто ждём кнопку «Сделал» */ } finally { busy = false; }
  }, 2000);
}

export function unwatch(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}
