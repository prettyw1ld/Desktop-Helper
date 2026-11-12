// Политика организации: корпоративный режим. Если на компьютере есть политика, ИИ ходит только
// на адрес из неё, а облачные сервисы и выбор модели в настройках выключены.
// Без Electron, чтобы проверять тестами.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Features, Settings } from '../shared/types';

export interface PolicyAi {
  kind: 'openai' | 'ollama';   // openai: vLLM, LiteLLM и любой OpenAI-совместимый сервер
  url: string;
  model: string;
  visionModel: string;
  apiKey: string;
}

export interface Policy {
  org: string;
  ai: PolicyAi | null;         // null: ИИ выключен (в том числе когда политика испорчена)
  features: Features;
  problem: string;             // почему политика не принята целиком; пусто, если всё в порядке
}

export const ALL_FEATURES: Features = { chat: true, guide: true, inspect: true };
const FEATURE_KEYS = Object.keys(ALL_FEATURES) as (keyof Features)[];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

/** Адрес сервера модели: только http(s); без шифрования — только свой компьютер или явное allowHttp. */
export function checkUrl(value: string, allowHttp = false): string {
  let u: URL;
  try { u = new URL(value); } catch { return ''; }
  if (u.username || u.password) return '';
  if (u.protocol === 'https:') return value.replace(/\/+$/, '');
  if (u.protocol === 'http:' && (allowHttp || LOCAL.test(u.hostname))) return value.replace(/\/+$/, '');
  return '';
}

/**
 * Политика из разобранного JSON. Что-то не так с разделом ai — ИИ выключен целиком:
 * испорченная политика не должна открывать дорогу в облако.
 */
export function parsePolicy(raw: unknown): Policy {
  const off = (problem: string, org = ''): Policy => ({ org, ai: null, features: { ...ALL_FEATURES }, problem });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return off('policy is not an object');
  const o = raw as Record<string, unknown>;
  const org = str(o.org).slice(0, 80);
  const features = { ...ALL_FEATURES };
  if (o.features && typeof o.features === 'object') {
    const f = o.features as Record<string, unknown>;
    for (const k of FEATURE_KEYS) if (typeof f[k] === 'boolean') features[k] = f[k];
  }
  if (o.ai === null || o.ai === false || o.ai === undefined) return { org, ai: null, features, problem: '' };
  if (typeof o.ai !== 'object') return { ...off('ai must be an object', org), features };
  const a = o.ai as Record<string, unknown>;
  const kind = str(a.kind) === 'ollama' ? 'ollama' : 'openai';
  const url = checkUrl(str(a.url), a.allowHttp === true);
  const model = str(a.model);
  if (!url) return { ...off('ai.url must be https (http only for localhost or with allowHttp)', org), features };
  if (!model) return { ...off('ai.model is empty', org), features };
  return { org, ai: { kind, url, model, visionModel: str(a.visionModel) || model, apiKey: str(a.apiKey) }, features, problem: '' };
}

/** Вывод `reg query` → значения ключа: «    AiUrl    REG_SZ    https://…». */
export function parseReg(out: string): Record<string, string> {
  const res: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/.exec(line);
    if (m) res[m[1]!] = m[2]!.trim();
  }
  return res;
}

const regBool = (v: string | undefined): boolean | undefined => (v === undefined ? undefined : !/^(0x0+|0|false)?$/i.test(v));

/** Значения из групповой политики (HKLM\Software\Policies\Pushik) → тот же вид, что у policy.json. */
export function regToRaw(v: Record<string, string>): Record<string, unknown> | null {
  if (!Object.keys(v).length) return null;
  const raw: Record<string, unknown> = {};
  if (v.Org) raw.org = v.Org;
  const features: Record<string, boolean> = {};
  for (const [name, key] of [['Chat', 'chat'], ['Guide', 'guide'], ['Inspect', 'inspect']] as const) {
    const b = regBool(v[name]);
    if (b !== undefined) features[key] = b;
  }
  if (Object.keys(features).length) raw.features = features;
  if (regBool(v.AiOff)) raw.ai = null;
  else if (v.AiUrl || v.AiModel) {
    raw.ai = { kind: v.AiKind, url: v.AiUrl, model: v.AiModel, visionModel: v.AiVisionModel, allowHttp: regBool(v.AiAllowHttp) === true };
  }
  return raw;
}

export const REG_KEY = 'HKLM\\Software\\Policies\\Pushik';

/** Где лежит policy.json: писать туда может только администратор. */
export function policyFile(platform = process.platform, env = process.env): string {
  if (platform === 'win32') return path.join(env.ProgramData || 'C:\\ProgramData', 'Pushik', 'policy.json');
  if (platform === 'darwin') return '/Library/Application Support/Pushik/policy.json';
  return '/etc/pushik/policy.json';
}

function readReg(): Record<string, unknown> | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', REG_KEY], { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    return regToRaw(parseReg(out));
  } catch {
    return null; // ключа нет
  }
}

/** Политика этого компьютера или null, если её нет (обычный Пушик). Групповая политика главнее файла. */
export function readPolicy(): Policy | null {
  let fileRaw: unknown;
  let broken = false;
  const file = policyFile();
  if (fs.existsSync(file)) {
    try { fileRaw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { broken = true; }
  }
  const reg = readReg();
  if (broken && !reg) return parsePolicy(null);
  if (fileRaw === undefined && !reg) return null;
  const base = fileRaw && typeof fileRaw === 'object' ? fileRaw as Record<string, unknown> : {};
  return parsePolicy(reg ? { ...base, ...reg } : fileRaw);
}

/** Поля настроек, которыми в корпоративном режиме управляет только политика. */
export const LOCKED = ['provider', 'aiChosen', 'aiUrl', 'model', 'visionModel', 'ollamaUrl', 'ollamaModel',
  'apiKey', 'groqKey', 'deepseekKey', 'qwenKey', 'voice', 'sttUrl', 'sttKey', 'sttModel'] as const satisfies readonly (keyof Settings)[];

/** Настройки с политикой поверх: модель только из неё, облачных ключей и облачного голоса нет. */
export function enforce(s: Settings, p: Policy): Settings {
  const ai = p.ai;
  return {
    ...s,
    provider: ai?.kind === 'ollama' ? 'ollama' : 'openai',
    aiChosen: false,
    aiUrl: ai?.kind === 'openai' ? ai.url : '',
    model: ai?.model ?? '',
    visionModel: ai?.visionModel ?? '',
    ollamaUrl: ai?.kind === 'ollama' ? ai.url : '',
    ollamaModel: ai?.kind === 'ollama' ? ai.model : '',
    apiKey: ai?.apiKey ?? '',
    groqKey: '',
    deepseekKey: '',
    qwenKey: '',
    voice: 'offline',   // распознавание речи только на самом компьютере (Vosk)
    sttUrl: '',
    sttKey: '',
  };
}

/** Единственный адрес, куда можно ходить за ответом ИИ; null — никуда. */
export const allowedOrigin = (p: Policy): string | null => (p.ai ? new URL(p.ai.url).origin : null);

/** Можно ли обратиться по адресу: only undefined — ограничений нет (обычный Пушик), null — никуда нельзя. */
export function originAllowed(only: string | null | undefined, url: string): boolean {
  if (only === undefined) return true;
  if (only === null) return false;
  try { return new URL(url).origin === only; } catch { return false; }
}
