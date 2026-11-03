// Чат Пуша: Claude (Messages API), любой сервис, совместимый с OpenAI (Groq, OpenRouter, LM Studio…),
// или локальная Ollama. Claude и Ollama ещё умеют вызывать инструменты (напоминания).
import type { Settings } from '../../shared/types';
import { aiError, fetchAI, fetchAIRetry, readError } from './http';

export const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

interface Preset { url: string; model: string; vision: string }

// Готовые настройки для OpenAI-совместимых сервисов: команде достаточно вписать ключ в team.json.
export const OPENAI_PRESETS: Record<'groq' | 'openrouter', Preset> = {
  // Проверено на ключе команды 25.10.2026: gpt-oss-120b лучше пишет по-русски, но не видит картинки;
  // qwen3.8-27b понимает снимки экрана и JSON
  groq: { url: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', vision: 'qwen/qwen3.8-27b' },
  openrouter: { url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', vision: 'qwen/qwen2.5-vl-72b-instruct:free' },
};

export type Resolved = { kind: 'claude' | 'ollama' } | { kind: 'openai'; url: string; model: string; vision: string };

// provider: claude | ollama | openai | groq | openrouter → куда и с какой моделью идти
export function resolve(s: Pick<Settings, 'provider' | 'aiUrl' | 'model' | 'visionModel'>): Resolved {
  const p = s.provider || 'claude';
  if (p === 'claude' || p === 'ollama') return { kind: p };
  const pre: Partial<Preset> = p === 'groq' || p === 'openrouter' ? OPENAI_PRESETS[p] : {};
  const url = (s.aiUrl || pre.url || OPENAI_PRESETS.groq.url).replace(/\/+$/, '');
  const claudeModel = /^claude-/.test(s.model || '');
  return {
    kind: 'openai',
    url,
    model: (!claudeModel && s.model) || pre.model || OPENAI_PRESETS.groq.model,
    vision: s.visionModel || pre.vision || OPENAI_PRESETS.groq.vision,
  };
}

// Сервисы меняют список моделей. Если нужной нет, берём подходящую из того, что есть у ключа.
const CHAT_PREFS = [/gpt-oss-120b/, /qwen3/, /gpt-oss/, /llama-3\.3-70b/, /llama/];
const VISION_PREFS = [/qwen3/, /llama-4/, /vl|vision/i];
const modelCache = new Map<string, string[]>();

async function listModels(url: string, apiKey: string): Promise<string[] | null> {
  const cached = modelCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetchAI(`${url}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { id: string }[] };
    const ids = (data.data || []).map((m) => m.id).filter((id) => !/whisper|tts|orpheus|guard|embed/i.test(id));
    modelCache.set(url, ids);
    return ids;
  } catch {
    return null;
  }
}

export async function pickModel({ url, apiKey, want, vision = false }: { url: string; apiKey: string; want: string; vision?: boolean }): Promise<string> {
  const ids = await listModels(url, apiKey);
  if (!ids || !ids.length || ids.includes(want)) return want;
  for (const re of vision ? VISION_PREFS : CHAT_PREFS) {
    const hit = ids.find((id) => re.test(id));
    if (hit) return hit;
  }
  return vision ? want : ids[0] ?? want;
}

// gpt-oss сначала «думает», и на короткий лимит ответа не остаётся: просим думать поменьше
export const extraFor = (model: string): Record<string, string> => (/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {});

// окошко не показывает разметку: убираем «размышления» и звёздочки
export const cleanReply = (txt: unknown): string => String(txt || '')
  .replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '')
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim();

// ---------- Инструменты чата ----------
export type ToolInput = Record<string, unknown>;
export type ChatTools = Record<string, (input: ToolInput) => unknown>;

interface ToolDef { name: string; description: string; schema: Record<string, unknown> }

const TOOLS: ToolDef[] = [
  {
    name: 'set_reminder',
    description: 'Set a reminder for the user in the given number of minutes.',
    schema: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'In how many minutes to remind' },
        text: { type: 'string', description: 'Reminder text' },
      },
      required: ['minutes', 'text'],
    },
  },
  {
    name: 'list_reminders',
    description: 'List active reminders and focus sessions.',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_reminder',
    description: 'Cancel a reminder by id (get ids from list_reminders).',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'start_focus',
    description: 'Start a focus (pomodoro) session for the given number of minutes.',
    schema: { type: 'object', properties: { minutes: { type: 'number' } }, required: ['minutes'] },
  },
  {
    name: 'get_calendar_events',
    description: "Get the user's Google Calendar events for the next N days (default 1 = today).",
    schema: { type: 'object', properties: { days: { type: 'number' } } },
  },
];

export function systemPrompt({ userName, lang }: { userName?: string; lang?: string }): string {
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  const now = new Date().toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
  const ru = [
    'Ты Пушик, добрый пиксельный кот.',
    'Ты живёшь на рабочем столе и помогаешь человеку, который только знакомится с компьютером.',
    'Объясняй очень просто, без компьютерных терминов, по одному действию за раз. Описывай, где что на экране и как выглядит.',
    'Никогда не проси пароли, номера карт и коды из СМС. Если что-то похоже на обман, предупреди.',
    'Отвечай коротко и тепло, по-русски, если человек не пишет на другом языке.',
    'Иногда можно вставить «мяу» или «мур», но без перебора. Ответ показывается в маленьком окошке,',
    'поэтому избегай длинных простыней текста. Не используй разметку: ни звёздочек, ни решёток, ни таблиц.',
    userName ? `Пользователя зовут ${userName}.` : '',
    `Сейчас: ${now}.`,
  ];
  const en = [
    'You are Pushik, a kind pixel cat.',
    'You live on the desktop and help a person who is just getting to know the computer.',
    'Explain very simply, without computer jargon, one action at a time. Never ask for passwords, card numbers or SMS codes.',
    'Answer briefly and kindly, in English unless the user writes in another language.',
    'You may add a "meow" or "purr" now and then, but not too often. Replies are shown in a small window,',
    'so avoid long walls of text and complex formatting.',
    userName ? `The user's name is ${userName}.` : '',
    `Now: ${now}.`,
  ];
  return (lang === 'en' ? en : ru).filter(Boolean).join(' ');
}

async function runTool(tools: ChatTools, name: string, input: unknown): Promise<string> {
  const fn = tools[name];
  if (!fn) return 'Unknown tool';
  try {
    return String(await fn((input || {}) as ToolInput));
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

/** Реплика истории чата: только текст, чтобы её было легко обрезать. */
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

interface AskInput {
  apiKey: string;
  model: string;
  url: string;
  ollamaUrl: string;
  ollamaModel: string;
  history: ChatMessage[];
  text: string;
  tools: ChatTools;
  system: string;
}
interface AskOutput { reply: string; actions: string[] }

// ---------- Claude ----------
interface ClaudeBlock { type: string; text?: string; id?: string; name?: string; input?: unknown }

async function askClaude({ apiKey, model, history, text, tools, system }: AskInput): Promise<AskOutput> {
  const messages: { role: string; content: unknown }[] = [...history, { role: 'user', content: text }];
  const actions: string[] = [];
  const defs = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));

  for (let step = 0; step < 6; step++) {
    const res = await fetchAI(CLAUDE_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1024, system, tools: defs, messages }),
    });
    if (!res.ok) throw await readError(res);
    const data = await res.json() as { content: ClaudeBlock[]; stop_reason: string };
    messages.push({ role: 'assistant', content: data.content });

    const uses = data.content.filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || uses.length === 0) {
      return { reply: data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), actions };
    }
    const results = [];
    for (const u of uses) {
      actions.push(u.name ?? '');
      results.push({ type: 'tool_result', tool_use_id: u.id, content: await runTool(tools, u.name ?? '', u.input) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('too many steps');
}

// ---------- OpenAI-совместимые (Groq, OpenRouter, …) ----------
async function askOpenAI({ apiKey, url, model, history, text, system }: AskInput): Promise<AskOutput> {
  const use = await pickModel({ url, apiKey, want: model });
  const res = await fetchAIRetry(`${url}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: use, max_tokens: 1500, ...extraFor(use),
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return { reply: cleanReply(data.choices?.[0]?.message?.content), actions: [] };
}

// ---------- Ollama ----------
interface OllamaMessage {
  role: string;
  content?: string;
  tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  tool_name?: string;
}

async function askOllama({ ollamaUrl, ollamaModel, history, text, tools, system }: AskInput): Promise<AskOutput> {
  const base = ollamaUrl.replace(/\/+$/, '');
  const messages: OllamaMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: text }];
  const actions: string[] = [];
  let defs = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));

  for (let step = 0; step < 6; step++) {
    let res: Response;
    try {
      res = await fetchAI(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: ollamaModel, messages, tools: defs.length ? defs : undefined, stream: false }),
      });
    } catch {
      throw aiError('offline', { offline: true });
    }
    if (!res.ok) {
      const err = await readError(res);
      // модель без поддержки инструментов: просто болтаем без них
      if (defs.length && /does not support tools/i.test(err.message)) { defs = []; continue; }
      throw err;
    }
    const msg = ((await res.json()) as { message?: OllamaMessage }).message || { role: 'assistant' };
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { reply: String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), actions };
    }
    for (const c of calls) {
      const name = c.function?.name ?? '';
      let args = c.function?.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      actions.push(name);
      messages.push({ role: 'tool', tool_name: name, content: await runTool(tools, name, args) });
    }
  }
  throw new Error('too many steps');
}

export type AskOptions = Settings & { history: ChatMessage[]; text: string; tools: ChatTools };

/** Вызовы инструментов живут внутри одного запроса; в историю попадает только текст. */
export async function ask(opts: AskOptions): Promise<AskOutput & { history: ChatMessage[] }> {
  const system = systemPrompt(opts);
  const r = resolve(opts);
  const input: AskInput = {
    ...opts,
    url: r.kind === 'openai' ? r.url : '',
    model: r.kind === 'openai' ? r.model : opts.model,
    system,
  };
  const fn = r.kind === 'ollama' ? askOllama : r.kind === 'openai' ? askOpenAI : askClaude;
  const { reply, actions } = await fn(input);
  const text = reply || (opts.lang === 'en' ? 'Purr!' : 'Мур!');
  return {
    reply: text,
    actions,
    history: [...opts.history, { role: 'user', content: opts.text }, { role: 'assistant', content: text }],
  };
}
