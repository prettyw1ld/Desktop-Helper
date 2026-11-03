// Куда идти за ответом: готовые настройки сервисов ИИ и мелочи их запросов. Без Electron, чтобы проверять тестами.
import type { Settings } from '../../shared/types';

export interface Preset {
  url: string;     // адрес OpenAI-совместимого API
  model: string;   // чат
  vision: string;  // снимок экрана: подсказки и «Объясни, что это»
}

// Сервисы, совместимые с OpenAI: команде достаточно вписать ключ в team.json или в настройках.
export const OPENAI_PRESETS = {
  // Проверено на ключе команды 25.10.2026: gpt-oss-120b лучше пишет по-русски, но не видит картинки;
  // qwen3.8-27b понимает снимки экрана и JSON. Ключ Groq ещё и включает голос (Whisper).
  groq: { url: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', vision: 'qwen/qwen3.8-27b' },
  // DeepSeek-V4.1-Flash: одна модель и для текста, и для картинок (api-docs.deepseek.com, ноябрь 2026)
  deepseek: { url: 'https://api.deepseek.com', model: 'deepseek-flash', vision: 'deepseek-flash' },
  // Qwen 3.8 Flash в Alibaba Cloud Model Studio, международный регион (Сингапур); тоже видит картинки
  qwen: { url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', vision: 'qwen3.8-flash' },
  openrouter: { url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', vision: 'qwen/qwen2.5-vl-72b-instruct:free' },
} satisfies Record<string, Preset>;

export type PresetName = keyof typeof OPENAI_PRESETS;
const isPreset = (p: string): p is PresetName => p in OPENAI_PRESETS;

export type Resolved = { kind: 'claude' | 'ollama' } | { kind: 'openai'; url: string; model: string; vision: string };

/** provider: claude | ollama | openai | groq | deepseek | qwen | openrouter → куда и с какой моделью идти. */
export function resolve(s: Pick<Settings, 'provider' | 'aiUrl' | 'model' | 'visionModel'>): Resolved {
  const p = s.provider || 'claude';
  if (p === 'claude' || p === 'ollama') return { kind: p };
  const pre: Partial<Preset> = isPreset(p) ? OPENAI_PRESETS[p] : {};
  const url = (s.aiUrl || pre.url || OPENAI_PRESETS.groq.url).replace(/\/+$/, '');
  const claudeModel = /^claude-/.test(s.model || '');
  return {
    kind: 'openai',
    url,
    model: (!claudeModel && s.model) || pre.model || OPENAI_PRESETS.groq.model,
    vision: s.visionModel || pre.vision || OPENAI_PRESETS.groq.vision,
  };
}

/**
 * Лишние поля запроса для конкретной модели. «Размышления» перед ответом кот не показывает,
 * а ждать их приходится в разы дольше: где можно, выключаем.
 */
export function extraFor(model: string, url = ''): Record<string, unknown> {
  if (/gpt-oss/.test(model)) return { reasoning_effort: 'low' };       // Groq: думать поменьше
  if (/deepseek\.com/.test(url)) return { thinking: { type: 'disabled' } };
  if (/aliyuncs\.com/.test(url)) return { enable_thinking: false };    // Qwen в Model Studio
  return {};
}

// Сервисы меняют список моделей. Если нужной нет, берём подходящую из того, что есть у ключа.
const CHAT_PREFS = [/gpt-oss-120b/, /qwen3/, /gpt-oss/, /llama-3\.3-70b/, /llama/];
const VISION_PREFS = [/qwen3/, /llama-4/, /vl|vision/i];

/** Какую модель взять из списка сервиса, если `want` в нём нет. */
export function fallbackModel(ids: string[], want: string, vision: boolean): string {
  if (!ids.length || ids.includes(want)) return want;
  // хотели «flash»: берём самую новую flash того же сервиса (qwen3.8-flash новее qwen3.7-flash)
  if (/flash/.test(want)) {
    const flash = ids.filter((id) => /flash$/.test(id)).sort().reverse()[0];
    if (flash) return flash;
  }
  for (const re of vision ? VISION_PREFS : CHAT_PREFS) {
    const hit = ids.find((id) => re.test(id));
    if (hit) return hit;
  }
  return vision ? want : ids[0] ?? want;
}
