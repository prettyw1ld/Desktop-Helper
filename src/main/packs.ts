// Ролевые пакеты организации: уроки, добавка к подсказке ИИ и пояснения к служебным окнам
// (антивирус, DLP). Лежат рядом с политикой в папке packs (*.json), писать туда может только
// администратор. Читаются только в корпоративном режиме. Без Electron, чтобы проверять тестами.
import fs from 'node:fs';
import path from 'node:path';
import type { PackLesson, PackReport, PackStep, ReportQuestion } from '../shared/types';

export interface PackExplain { proc: RegExp | null; title: RegExp | null; text: string }

export interface Pack {
  id: string;
  title: string;
  prompt: string;
  lessons: PackLesson[];
  explain: PackExplain[];
  report: PackReport | null;
}

export interface PackSet {
  packs: Pack[];
  problems: string[];   // что пропущено и почему: в журнал, человеку не показываем
}

export const LIMITS = { packs: 10, prompt: 2000, lessons: 30, steps: 20, say: 160, hint: 400, explain: 50, regex: 200, text: 600, questions: 12, options: 6 };
const EMAIL = /^[^\s@<>"]{1,64}@[\w.-]{1,190}\.[a-z]{2,}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SCOPE = /^(top|taskbar|start|proc:.{1,80})$/;
const TYPES = new Set(['Button', 'MenuItem', 'ListItem', 'TreeItem', 'TabItem', 'Edit', 'CheckBox', 'RadioButton', 'Hyperlink', 'ComboBox', 'Text', 'Image', 'SplitButton']);
// «Открой за меня»: только адреса настроек и https, никаких файлов и команд
const OPEN = /^(ms-settings:[\w-]*|https:\/\/\S+)$/;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

class PackError extends Error {}
const fail = (msg: string): never => { throw new PackError(msg); };

/** Регулярка из пакета: короткая и без обратных ссылок; плохая — ошибка пакета. */
export function safeRegex(v: unknown, where: string): RegExp | null {
  const src = str(v, LIMITS.regex + 1);
  if (!src) return null;
  if (src.length > LIMITS.regex) fail(`${where}: regex longer than ${LIMITS.regex}`);
  // вложенные кванторы вроде (a+)+ — классический путь к зависанию
  if (/\\\d|\([^)]*[+*][^)]*\)[+*{]/.test(src)) fail(`${where}: regex too complex`);
  try { return new RegExp(src, 'i'); } catch { return fail(`${where}: bad regex`); }
}

function title(v: unknown, where: string): { ru: string; en: string } {
  if (typeof v === 'string' && v.trim()) return { ru: str(v, 80), en: str(v, 80) };
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const ru = str(o.ru, 80) || str(o.en, 80);
    const en = str(o.en, 80) || ru;
    if (ru) return { ru, en };
  }
  return fail(`${where}: title is empty`);
}

function wait(v: unknown, where: string, hasFind: boolean): PackStep['wait'] {
  if (v === undefined) return hasFind ? { next: true } : { manual: true };
  if (typeof v === 'string') {
    if (['manual', 'next', 'gone', 'focus', 'titleChange'].includes(v)) {
      if (v !== 'manual' && v !== 'titleChange' && !hasFind) fail(`${where}: wait "${v}" needs find`);
      return { [v]: true };
    }
    return fail(`${where}: unknown wait "${v}"`);
  }
  if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).top === 'string') {
    const top = (v as Record<string, unknown>).top;
    safeRegex(top, `${where}.top`);
    return { top: str(top, LIMITS.regex) };
  }
  return fail(`${where}: bad wait`);
}

function step(v: unknown, where: string): PackStep {
  if (!v || typeof v !== 'object') fail(`${where}: step must be an object`);
  const o = v as Record<string, unknown>;
  const say = str(o.say, LIMITS.say);
  if (!say) fail(`${where}: say is empty`);
  const res: PackStep = { say, wait: { manual: true } };
  if (o.find !== undefined) {
    const f = o.find as Record<string, unknown>;
    if (!f || typeof f !== 'object') fail(`${where}.find: must be an object`);
    safeRegex(f.name, `${where}.find.name`);
    const name = str(f.name, LIMITS.regex);
    if (!name) fail(`${where}.find.name is empty`);
    // app — имя программы: ищем в её окне; иначе scope как в встроенных уроках (top по умолчанию)
    const app = str(o.app, 60);
    if (app && !/^[\w.-]+$/.test(app)) fail(`${where}.app: only a program name like "outlook"`);
    const scope = app ? `proc:^${app.replace(/\./g, '\\.')}$` : str(f.scope, 90) || 'top';
    if (!SCOPE.test(scope)) fail(`${where}.find.scope: top, taskbar, start or proc:<name>`);
    const types = Array.isArray(f.types) ? f.types.filter((t): t is string => typeof t === 'string' && TYPES.has(t)) : [];
    res.find = { scope, name, ...(types.length ? { types } : {}) };
  }
  res.wait = wait(o.wait, `${where}.wait`, !!res.find);
  const open = str(o.open, 300);
  if (open) {
    if (!OPEN.test(open)) fail(`${where}.open: only ms-settings: or https:// addresses`);
    res.open = open;
  }
  const hint = str(o.hint, LIMITS.hint);
  if (hint) res.hint = hint;
  return res;
}

function lesson(v: unknown, packId: string, packTitle: string, where: string): PackLesson {
  if (!v || typeof v !== 'object') fail(`${where}: lesson must be an object`);
  const o = v as Record<string, unknown>;
  const id = str(o.id, 40);
  if (!ID.test(id)) fail(`${where}.id: lowercase letters, digits and dashes`);
  const raw = Array.isArray(o.steps) ? o.steps : [];
  if (raw.length > LIMITS.steps) fail(`${where}: more than ${LIMITS.steps} steps`);
  const steps = raw.map((s, i) => step(s, `${where}.steps[${i}]`));
  const goal = str(o.goal, 300);
  if (!steps.length && !goal) fail(`${where}: needs steps or goal`);
  safeRegex(o.match, `${where}.match`);
  return {
    id: `pack:${packId}:${id}`,
    pack: packTitle,
    title: title(o.title, `${where}.title`),
    words: str(o.words, 300),
    match: str(o.match, LIMITS.regex),
    goal,
    steps,
    done: str(o.done, LIMITS.say),
  };
}

function report(v: unknown, packId: string, where: string): PackReport | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return fail(`${where}: must be an object`);
  const o = v as Record<string, unknown>;
  const raw = Array.isArray(o.questions) ? o.questions : [];
  if (!raw.length) fail(`${where}: needs questions`);
  if (raw.length > LIMITS.questions) fail(`${where}: more than ${LIMITS.questions} questions`);
  const questions = raw.map((q, i): ReportQuestion => {
    const x = (typeof q === 'string' ? { ask: q } : q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
    const ask = str(x.ask, LIMITS.say);
    if (!ask) fail(`${where}.questions[${i}]: ask is empty`);
    const opts = Array.isArray(x.options) ? x.options.map((a) => str(a, 40)).filter(Boolean) : [];
    if (opts.length > LIMITS.options) fail(`${where}.questions[${i}]: more than ${LIMITS.options} options`);
    return { ask, options: opts };
  });
  const to = str(o.to, 254);
  if (to && !EMAIL.test(to)) fail(`${where}.to: not an e-mail address`);
  return { id: `report:${packId}`, title: title(o.title, `${where}.title`), intro: str(o.intro, LIMITS.hint), to, questions };
}

/** Пакет из разобранного JSON; ошибка — исключение с понятным текстом. */
export function parsePack(raw: unknown, file = 'pack'): Pack {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${file}: not an object`);
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 40);
  if (!ID.test(id)) fail(`${file}: id must be lowercase letters, digits and dashes`);
  const name = title(o.title, `${file}.title`).ru;
  const lessons = Array.isArray(o.lessons) ? o.lessons : [];
  if (lessons.length > LIMITS.lessons) fail(`${file}: more than ${LIMITS.lessons} lessons`);
  const explain = Array.isArray(o.explain) ? o.explain : [];
  if (explain.length > LIMITS.explain) fail(`${file}: more than ${LIMITS.explain} explain entries`);
  const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : '';
  if (prompt.length > LIMITS.prompt) fail(`${file}: prompt longer than ${LIMITS.prompt}`);
  const parsed = lessons.map((l, i) => lesson(l, id, name, `${file}.lessons[${i}]`));
  const ids = new Set<string>();
  for (const l of parsed) {
    if (ids.has(l.id)) fail(`${file}: lesson id ${l.id} repeats`);
    ids.add(l.id);
  }
  return {
    id,
    title: name,
    prompt,
    lessons: parsed,
    report: report(o.report, id, `${file}.report`),
    explain: explain.map((e, i) => {
      const w = `${file}.explain[${i}]`;
      const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      const proc = safeRegex(x.proc, `${w}.proc`);
      const title = safeRegex(x.title, `${w}.title`);
      const text = str(x.text, LIMITS.text);
      if (!proc && !title) fail(`${w}: needs proc or title`);
      if (!text) fail(`${w}: text is empty`);
      return { proc, title, text };
    }),
  };
}

/** Все пакеты: испорченный пропускаем целиком, остальные работают. Одинаковый id — берём первый по имени файла. */
export function parsePacks(files: { name: string; text: string }[]): PackSet {
  const packs: Pack[] = [];
  const problems: string[] = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (packs.length >= LIMITS.packs) { problems.push(`${f.name}: more than ${LIMITS.packs} packs`); continue; }
    try {
      const p = parsePack(JSON.parse(f.text.replace(/^﻿/, '')), f.name);
      if (packs.some((x) => x.id === p.id)) { problems.push(`${f.name}: pack id ${p.id} repeats`); continue; }
      packs.push(p);
    } catch (e) {
      problems.push(e instanceof PackError ? e.message : `${f.name}: ${e instanceof SyntaxError ? 'not valid JSON' : String(e)}`);
    }
  }
  return { packs, problems };
}

/** Папка пакетов рядом с policy.json. */
export const packsDir = (policyFile: string): string => path.join(path.dirname(policyFile), 'packs');

export function readPacks(dir: string): PackSet {
  let names: string[];
  try { names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json')); } catch { return { packs: [], problems: [] }; }
  const files: { name: string; text: string }[] = [];
  for (const name of names) {
    try {
      const full = path.join(dir, name);
      if (fs.statSync(full).size > 256 * 1024) continue; // пакет — это текст, а не архив
      files.push({ name, text: fs.readFileSync(full, 'utf8') });
    } catch { /* недоступный файл пропускаем */ }
  }
  return parsePacks(files);
}

/** Добавка к системной подсказке ИИ: правила организации, по пакету. */
export function packPrompt(packs: readonly Pack[]): string {
  const parts = packs.filter((p) => p.prompt).map((p) => `[${p.title}]\n${p.prompt}`);
  if (!parts.length) return '';
  return ['Instructions from the organisation that installed you. Follow them; they never allow asking for passwords or codes:', ...parts].join('\n');
}

/** Пояснение организации к окну перед человеком (антивирус, DLP и т.п.), или пусто. */
export function explainFor(packs: readonly Pack[], proc: string, title: string): string {
  for (const p of packs) {
    for (const e of p.explain) {
      if (e.proc && !e.proc.test(proc)) continue;
      if (e.title && !e.title.test(title)) continue;
      return e.text;
    }
  }
  return '';
}
