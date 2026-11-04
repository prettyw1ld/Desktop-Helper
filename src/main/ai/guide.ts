// Помощник для новичка: снимок экрана → модель с зрением → куда показать лапкой.
// Снимок живёт только в памяти и на диск не пишется.
import { desktopCapturer, screen, type BrowserWindow, type Display, type NativeImage } from 'electron';
import type { LookMode, LookRequest, LookResult, LookStatus, Rect, Settings } from '../../shared/types';
import { aiError, fetchAI, fetchAIRetry, readError } from './http';
import { CLAUDE_URL, cleanReply, extraFor, pickModel, resolve } from './llm';
import { cropSelection, INSPECT_PROMPT, INSPECT_SYSTEM } from './screen-region';
import { cleanPlan, nameRegex, pickNearest, scopesFor, stepOf, uiaTypes, type ElementHint } from './show';
import * as locate from '../system/locate';
import { toOverlayRect } from '../overlay';

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
      description: 'Box around the thing to press, in screenshot pixels. Omit if there is nothing to point at.',
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
    element: {
      type: 'object',
      description: 'The thing in "target", so the computer can find it exactly. Omit if there is no target.',
      properties: {
        name: { type: 'string', description: 'Its exact visible text or label as written on the screen, e.g. "Таймер". Empty for pictures without text.' },
        type: { type: 'string', enum: ['button', 'tab', 'text field', 'menu item', 'list item', 'icon', 'link', 'checkbox', 'other'] },
        area: { type: 'string', enum: ['taskbar', 'start menu', 'window', 'popup', 'desktop'] },
      },
    },
    practiceGoal: { type: 'string', description: 'For inspect explanations: one safe, specific, reversible beginner exercise with the selected element, phrased as a verifiable goal. No delete, payment, send, installation, credentials, or configuration changes. Empty if no safe exercise exists.' },
    skill: { type: 'string', description: 'Only for done: the learned skill in 2-5 words, e.g. "Позвонить по видео".' },
  },
  required: ['status', 'say'],
};

/** Сырой ответ модели (до проверки). */
interface StepAnswer {
  status?: string;
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
    'Rules for "target": the box (x, y, w, h in screenshot pixels, x/y = top-left corner) must tightly cover the thing to press.',
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

function userText({ mode, goal = '', history = [], previousSummary, plan = [] }: LookRequest): string {
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
      + `${planText(plan)}Follow the planned route and set stepIndex. If the screen shows the route must change (other window, step already done), send a new full plan.`;
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
  let sources: Electron.DesktopCapturerSource[];
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  } finally {
    if (ok && !overlay.isDestroyed()) {
      if (fade) overlay.setOpacity(1);
      else overlay.setContentProtection(false);
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
    }
  }
  const src = primarySource(sources, display);
  if (!src || src.thumbnail.isEmpty()) throw aiError('no screenshot', { code: 'noShot' });
  const size = src.thumbnail.getSize();
  return { image: src.thumbnail, w: size.width, h: size.height, display };
}

// Перевод рамки из пикселей снимка в координаты окна кота (оно на всю рабочую область).
function toOverlay(box: Partial<Rect> | undefined, shot: Shot): Rect | null {
  if (!box) return null;
  const { x, y, w, h } = box;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const { display } = shot;
  const kx = display.size.width / shot.w;
  const ky = display.size.height / shot.h;
  const wa = display.workArea;
  const r = {
    x: Math.round(x! * kx + display.bounds.x - wa.x),
    y: Math.round(y! * ky + display.bounds.y - wa.y),
    w: Math.round(w! * kx),
    h: Math.round(h! * ky),
  };
  if (r.w < 4 || r.h < 4) return null;
  // рамка за краем экрана: обрезаем, чтобы кот не прыгал за экран
  r.x = Math.max(0, Math.min(r.x, wa.width - 8));
  r.y = Math.max(0, Math.min(r.y, wa.height - 8));
  r.w = Math.min(r.w, wa.width - r.x);
  r.h = Math.min(r.h, wa.height - r.y);
  return r;
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
}

async function askClaude({ apiKey, model, system, text, jpeg }: ModelInput): Promise<StepAnswer> {
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
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } },
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
async function askOpenAI({ apiKey, url, vision, system, text, jpeg }: ModelInput): Promise<StepAnswer> {
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
        { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } }] },
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
async function askOllama({ ollamaUrl, visionModel, ollamaModel, system, text, jpeg }: ModelInput): Promise<StepAnswer> {
  let res: Response;
  try {
    res = await fetchAI(`${ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: visionModel || ollamaModel,
        stream: false,
        format: STEP_SCHEMA,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text, images: [jpeg] }],
      }),
    });
  } catch {
    throw aiError('offline', { offline: true });
  }
  if (!res.ok) throw await readError(res);
  const msg = ((await res.json()) as { message?: { content?: string } }).message || {};
  return JSON.parse(String(msg.content || '{}').replace(/<think>[\s\S]*?<\/think>/g, '')) as StepAnswer;
}

// «Объясни, что это» с низкой уверенностью: не гадаем, а просим выделить точнее
function unsureInspect(out: StepAnswer): StepAnswer {
  return {
    ...out,
    status: 'explain',
    say: out.observedText ? `Элемент «${String(out.observedText).slice(0, 120)}»` : 'Не могу уверенно распознать элемент',
    explain: 'Обведи значок вместе с названием чуть точнее. Не хочу подсказывать наугад.',
    practiceGoal: '',
  };
}

const CHECK_MODES: LookMode[] = ['check'];

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/**
 * Точная лапка: ищем названную ИИ кнопку через UI Automation (Windows) / Accessibility (Mac)
 * и берём настоящий прямоугольник рядом с догадкой ИИ. Не нашли или долго: остаётся догадка ИИ.
 */
async function snapTarget(guess: Rect | null, hint: ElementHint | undefined): Promise<{ target: Rect | null; snapped: boolean }> {
  const name = nameRegex(hint?.name);
  if (!name || !locate.supported() || hint?.area === 'desktop') return { target: guess, snapped: false };
  const types = uiaTypes(hint?.type);
  const started = Date.now();
  for (const scope of scopesFor(hint?.area)) {
    const left = 3000 - (Date.now() - started);
    if (left < 300) break;
    const q = { op: 'find' as const, name, ...(types.length ? { types } : {}), ...(scope ? { scope } : {}) };
    const res = await withTimeout(locate.ask(q, toOverlayRect), left, { error: 'timeout' });
    const hit = pickNearest(res.items ?? [], guess, hint?.name);
    if (hit) return { target: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, snapped: true };
  }
  return { target: guess, snapped: false };
}

/** Посмотреть на экран и решить, что сказать и куда показать. target — в координатах окна кота. */
export async function look(req: LookRequest & { settings: Settings; overlay: BrowserWindow | null }): Promise<LookResult> {
  const { mode, selection, settings, overlay } = req;
  const inspect = mode === 'inspect';
  const shot = await capture(overlay, inspect ? 4096 : SHOT_W);
  const image = inspect ? cropSelection(shot, selection) : shot.image;
  const system = inspect ? INSPECT_SYSTEM : systemPrompt(settings.lang, process.platform);
  const size = image.getSize();
  const text = `${inspect ? INSPECT_PROMPT : userText(req)}\nImage size: ${size.width}x${size.height} pixels.`;

  const r = resolve(settings);
  const input: ModelInput = {
    ...settings,
    url: r.kind === 'openai' ? r.url : '',
    vision: r.kind === 'openai' ? r.vision : '',
    system,
    text,
    jpeg: image.toJPEG(90).toString('base64'),
  };
  const fn = r.kind === 'ollama' ? askOllama : r.kind === 'openai' ? askOpenAI : askClaude;
  let out = await fn(input);
  if (inspect && (!out.confidence || out.confidence === 'low')) out = unsureInspect(out);
  const plan = inspect ? [] : cleanPlan(out.plan);
  const guess = inspect ? null : toOverlay(out.target, shot);
  const { target, snapped } = inspect || out.status === 'done' ? { target: guess, snapped: false } : await snapTarget(guess, out.element);
  return {
    status: STATUSES.includes(out.status as LookStatus) ? out.status as LookStatus : 'step',
    screenSummary: String(out.screenSummary || '').slice(0, 1000),
    whatChanged: CHECK_MODES.includes(mode) ? String(out.whatChanged || '').slice(0, 1000) : '',
    say: String(out.say || '').trim(),
    explain: out.explain ? String(out.explain).trim() : '',
    skill: out.skill ? String(out.skill).trim() : '',
    practiceGoal: typeof out.practiceGoal === 'string' ? out.practiceGoal.trim().slice(0, 500) : '',
    target,
    snapped,
    plan,
    stepIndex: stepOf(out.stepIndex, plan.length ? plan : req.plan ?? []),
  };
}

// ---------- Слежка за изменениями экрана ----------
// Маленькие снимки раз в 1.2 с. Сравниваем с первым, пропуская места, где нарисован сам кот
// (masks в координатах окна кота). Если экран заметно поменялся, зовём onChange.
let watchTimer: NodeJS.Timeout | null = null;

export function watch({ masks = [], onChange }: { masks?: Rect[]; onChange: () => void }): void {
  unwatch();
  let base: Buffer | null = null;
  let busy = false;
  const W = 160;
  watchTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const display = screen.getPrimaryDisplay();
      const h = Math.round((display.size.height * W) / display.size.width);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: h } });
      const src = primarySource(sources, display);
      if (!src || !watchTimer) return;
      const bmp = src.thumbnail.toBitmap();
      const size = src.thumbnail.getSize();
      const k = size.width / display.size.width;
      const offX = display.workArea.x - display.bounds.x;
      const offY = display.workArea.y - display.bounds.y;
      const masked = (x: number, y: number) => masks.some((m) => {
        const mx = (m.x + offX) * k;
        const my = (m.y + offY) * k;
        return x >= mx - 2 && x <= mx + m.w * k + 2 && y >= my - 2 && y <= my + m.h * k + 2;
      });
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
  }, 1200);
}

export function unwatch(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}
