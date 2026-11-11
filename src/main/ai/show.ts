// Показ на экране вместо текста: разбор ответов модели. Без electron, чтобы легко проверять в тестах.
import type { LocateItem } from '../../shared/types';

// Метка в ответе чата: «не отвечай текстом, а покажи на экране».
export const SHOW_MARK = '[SHOW]';

/** «[SHOW] цель» в ответе модели → цель для показа на экране, иначе ''. */
export function showGoal(reply: string): string {
  const m = /\[\s*(?:SHOW|ПОКАЖУ|ПОКАЗАТЬ)\s*\]\s*[:\-–]?\s*(.+)/i.exec(reply);
  return m ? m[1]!.split('\n')[0]!.replace(/[«»"]/g, '').trim().slice(0, 300) : '';
}

// ---------- Точная лапка: элементы экрана от системы ----------
// ИИ по картинке промахивается. Windows (UI Automation) знает точные прямоугольники кнопок:
// мы даём ИИ пронумерованный список, он выбирает номер, и кот показывает ровно в кнопку.

/** Что ИИ сказал о кнопке, на которую показывает. */
export interface ElementHint { name?: string; type?: string; area?: string }

interface Box { x: number; y: number; w: number; h: number }

/** Кнопка от системы: где она на снимке (для ИИ) и в окне кота (для лапки). */
export interface Mark { id: number; name: string; type: string; area: string; shot: Box; overlay: Box; partial?: boolean }

const AREA: Record<string, string> = { taskbar: 'taskbar', popup: 'start menu / popup', window: 'window', desktop: 'desktop icon, may be hidden under windows' };

/** Список для ИИ: «[3] Button "Поиск" (taskbar) at 110,500 size 210x40». */
export function formatMarks(marks: Mark[], max = 160): string {
  const byName = 'If the thing to press is not in this list, fill "element" with its name exactly as written on the screen '
    + '(the system will find it by that name) and give "target". Never give a number of a different element.';
  if (!marks.length) return `No list of screen elements this time. ${byName}`;
  const lines = marks.slice(0, max).map((m) => {
    const name = m.name.replace(/\s+/g, ' ').trim().slice(0, 60);
    return `[${m.id}] ${m.type} "${name}" (${AREA[m.area] ?? m.area}) at ${m.shot.x},${m.shot.y} size ${m.shot.w}x${m.shot.h}`;
  });
  return 'Screen elements found by the system (number, type, name, where; coordinates in screenshot pixels):\n'
    + `${lines.join('\n')}\nIf the thing to press is one of these, put its number into "elementId". `
    + `Pick only what is really visible on the screenshot. ${byName}`;
}

const norm = (s = '') => s.replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * Какую кнопку показать: номер от ИИ, иначе кнопка с названным именем ближе всех к рамке ИИ
 * (или единственная с таким именем, даже если рамка ИИ далеко). Ничего не подошло: null, тогда остаётся рамка ИИ.
 */
export function pickMark(marks: Mark[], id: unknown, name = '', guess: Box | null = null, maxDist = 260): Mark | null {
  const n = Math.round(Number(id));
  const byId = Number.isFinite(n) ? marks.find((m) => m.id === n) : undefined;
  const want = norm(name);
  // номер верен, если у кнопки то же название, что назвал ИИ, или она там, где ИИ её видит.
  // Иначе ИИ взял первый попавшийся номер (так было: «Go» в VS Code → «Show Hidden Icons» на панели задач)
  if (byId) {
    const have = norm(byId.name);
    const sameName = want.length < 2 || (have.length >= 2 && (have.includes(want) || want.includes(have)));
    const g = guess && center(guess);
    const c = center(byId.overlay);
    const near = !!g && Math.hypot(c.x - g.x, c.y - g.y) <= maxDist;
    if (sameName || near) return byId;
  }
  if (want.length < 2) return null;
  const exact = marks.filter((m) => norm(m.name) === want);
  const pool = exact.length ? exact : marks.filter((m) => norm(m.name).startsWith(want));
  if (!pool.length) return null;
  if (!guess) return pool.length === 1 ? pool[0]! : null;
  const g = center(guess);
  let best: Mark | null = null;
  let bestD = Infinity;
  for (const m of pool) {
    const c = center(m.overlay);
    const d = Math.hypot(c.x - g.x, c.y - g.y);
    if (d < bestD) { best = m; bestD = d; }
  }
  if (bestD <= maxDist) return best;
  // ИИ промахнулся рамкой сильнее, но кнопка с таким именем на экране одна: показываем её
  return pool.length === 1 ? pool[0]! : null;
}

function nearest(pool: Mark[], p: { x: number; y: number } | null, max: number): Mark | null {
  if (!pool.length) return null;
  if (!p) return pool.length === 1 ? pool[0]! : null;
  let best: Mark | null = null;
  let bestD = Infinity;
  for (const m of pool) {
    const c = center(m.overlay);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) { best = m; bestD = d; }
  }
  return bestD <= max ? best : null;
}

const FIELD = /text|field|edit|search|input|box|поле|поиск|строк/i;
const isField = (m: Mark) => /^(Edit|ComboBox|Document)$/.test(m.type);

/**
 * Кнопка, которую система нашла по названию от ИИ (found; partial — название лишь содержит слова ИИ),
 * и поля ввода рядом (fields). ИИ просит «поле ввода», а назвал подсказку под ним — показываем само поле.
 */
export function pickNamed(found: Mark[], fields: Mark[], type: string, guess: Box | null, name = ''): Mark | null {
  const g = guess && center(guess);
  const want = bare(name);
  // сначала точное название («Go», а не «Go Forward»), потом подходящий тип, потом начало названия, потом часть
  const rank = (m: Mark) => (m.partial ? 4 : want && bare(m.name) === want ? 0 : 2) + (typeFits(type, m.type) ? 0 : 1);
  const best = Math.min(...found.map(rank));
  const top = found.filter((m) => rank(m) === best);
  let hit = nearest(top, g, 700) ?? (top.length === 1 && best <= 1 ? top[0]! : null);
  if (FIELD.test(type) && !(hit && isField(hit))) {
    const field = (hit && nearest(fields, center(hit.overlay), 160)) ?? nearest(fields, g, 300);
    if (field) hit = field;
  }
  return hit;
}

/** Название без «&», сочетания клавиш и пояснения в скобках: «Go Forward (Alt+RightArrow)» → «go forward». */
const bare = (s: string) => itemLabel(s.replace(/&/g, '')).replace(/\s*\([^)]*\)\s*$/, '').replace(/(\.\.\.|…)$/, '').trim().toLowerCase();

const TYPES: [RegExp, RegExp][] = [
  [/menu/i, /^MenuItem$/],
  [/tab/i, /^TabItem$/],
  [/list|tree/i, /^(ListItem|TreeItem|DataItem)$/],
  [/link/i, /^Hyperlink$/],
  [/check/i, /^CheckBox$/],
  [/text|field|edit|search|input|box|поле|поиск|строк/i, /^(Edit|ComboBox|Document)$/],
  [/button|icon|кноп|значок/i, /^(Button|SplitButton|MenuItem)$/],
];
function typeFits(asked: string, sys: string): boolean {
  const rule = TYPES.find(([a]) => a.test(asked));
  return !rule || rule[1].test(sys);
}

/**
 * В чём модель дала рамку. Просим пиксели снимка, но Qwen и некоторые другие по привычке
 * отвечают в долях 0..1000. Если рамка вылезает за снимок, но влезает в 1000×1000, это доли.
 */
export function boxUnits(box: Box, shotW: number, shotH: number): 'px' | 'k' {
  const outside = box.x + box.w > shotW * 1.02 || box.y + box.h > shotH * 1.02;
  const fitsK = box.x >= 0 && box.y >= 0 && box.x + box.w <= 1000 && box.y + box.h <= 1000;
  return outside && fitsK ? 'k' : 'px';
}

/** Номер шага в плане: целое от 1 до длины плана, иначе 0 (не показываем «Шаг N из M»). */
export function stepOf(index: unknown, plan: string[]): number {
  const n = Math.round(Number(index));
  return Number.isFinite(n) && n >= 1 && n <= plan.length ? n : 0;
}

/** План пути от модели: только непустые строки, не больше 12 шагов. */
export function cleanPlan(plan: unknown): string[] {
  if (!Array.isArray(plan)) return [];
  return plan.map((s) => String(s ?? '').replace(/^\s*\d+[.)]\s*/, '').trim().slice(0, 160)).filter(Boolean).slice(0, 12);
}

/**
 * Какой кусочек снимка в полном размере показать ИИ для уточнения: вокруг его рамки,
 * в 3 раза больше неё, но не меньше 560×380 и не больше 900×600, целиком внутри экрана.
 */
export function refineCrop(box: Box, fullW: number, fullH: number): Box {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = Math.round(Math.min(fullW, Math.max(560, Math.min(900, box.w * 3))));
  const h = Math.round(Math.min(fullH, Math.max(380, Math.min(600, box.h * 3))));
  const x = Math.round(Math.max(0, Math.min(fullW - w, cx - w / 2)));
  const y = Math.round(Math.max(0, Math.min(fullH - h, cy - h / 2)));
  return { x, y, w, h };
}

// Пока открыт «Пуск», Windows не отдаёт кнопки панели задач, хотя они на виду.
// Берём их из прошлого списка (панель задач почти не меняется), чтобы кот мог показать и туда.
let lastTaskbar: { items: LocateItem[]; at: number } | null = null;
export function withTaskbar(items: LocateItem[], now = Date.now()): LocateItem[] {
  const bar = items.filter((it) => it.area === 'taskbar');
  if (bar.length) { lastTaskbar = { items: bar, at: now }; return items; }
  if (!items.length || !lastTaskbar || now - lastTaskbar.at > 10 * 60_000) return items;
  return [...lastTaskbar.items, ...items];
}

/** Название пункта меню без сочетания клавиш в конце: «Go to Line/Column... Ctrl+G» → «Go to Line/Column...». */
export function itemLabel(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
    .replace(/\s+(?:(?:Ctrl|Alt|Shift|Win|Cmd|Option)\+[\w+\-]+|F\d{1,2})$/i, '')
    .trim().slice(0, 60);
}

/** Пункты из рассказа ИИ, если система их не дала: строки вида «Название» — что делает. */
export function itemsFromText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*[-•]?\s*«([^»]{1,60})»/.exec(line);
    if (m && !out.includes(m[1]!.trim())) out.push(m[1]!.trim());
  }
  return out;
}

/** Убрать элементы в строке нажатия (p — точка нажатия в пикселях экрана). */
export function sameRowOut<T extends { x: number; y: number; w: number; h: number }>(items: T[], p: { x: number; y: number } | null): T[] {
  if (!p) return items;
  const inRow = (it: T) => p.y >= it.y - 2 && p.y <= it.y + it.h + 2;
  const pressed = (it: T) => inRow(it) && p.x >= it.x - 2 && p.x <= it.x + it.w + 2;
  // в строке ещё две и больше кнопок — это строка меню или панель: убираем её целиком;
  // одна — скорее первый пункт подменю, открывшегося вбок: оставляем, убираем только нажатую
  const bar = items.filter((it) => inRow(it) && !pressed(it)).length >= 2;
  return items.filter((it) => !pressed(it) && !(bar && inRow(it)));
}

