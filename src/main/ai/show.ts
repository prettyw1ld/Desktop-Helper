// Показ на экране вместо текста: разбор ответов модели. Без electron, чтобы легко проверять в тестах.

// Метка в ответе чата: «не отвечай текстом, а покажи на экране».
export const SHOW_MARK = '[SHOW]';

/** «[SHOW] цель» в ответе модели → цель для показа на экране, иначе ''. */
export function showGoal(reply: string): string {
  const m = /\[\s*(?:SHOW|ПОКАЖУ|ПОКАЗАТЬ)\s*\]\s*[:\-–]?\s*(.+)/i.exec(reply);
  return m ? m[1]!.split('\n')[0]!.replace(/[«»"]/g, '').trim().slice(0, 300) : '';
}

// ---------- Точная лапка: уточняем место кнопки через «доступность» системы ----------
// ИИ по картинке промахивается на пару сантиметров. Он называет кнопку («Таймер»),
// а UI Automation (Windows) или Accessibility (Mac) знает её точный прямоугольник.

/** Что ИИ сказал о кнопке, на которую показывает. */
export interface ElementHint { name?: string; type?: string; area?: string }

interface Box { x: number; y: number; w: number; h: number }
interface Named extends Box { name: string }

const TYPES: Record<string, string[]> = {
  button: ['Button', 'SplitButton', 'MenuItem', 'ListItem'],
  tab: ['TabItem', 'Button', 'ListItem'],
  'text field': ['Edit', 'ComboBox'],
  'menu item': ['MenuItem', 'ListItem', 'Button'],
  'list item': ['ListItem', 'DataItem', 'TreeItem'],
  icon: ['ListItem', 'Button', 'TreeItem'],
  link: ['Hyperlink', 'Button', 'Text'],
  checkbox: ['CheckBox', 'RadioButton', 'Button'],
};

/** Тип элемента со слов ИИ → типы UI Automation; пусто = искать среди любых. */
export const uiaTypes = (type = ''): string[] => TYPES[type.toLowerCase().trim()] ?? [];

/** Где искать: сначала там, где ИИ видит кнопку, потом во всех окнах. */
export function scopesFor(area = ''): string[] {
  const a = area.toLowerCase();
  if (/task ?bar|панел/.test(a)) return ['taskbar'];
  if (/start|пуск/.test(a)) return ['start', 'popup'];
  return ['popup', ''];
}

/** Регулярка «имя целиком или имя в начале», без спецсимволов, без учёта регистра (в PowerShell -match). */
export function nameRegex(name = ''): string {
  const clean = name.replace(/[«»"“”]/g, '').trim().slice(0, 60);
  if (clean.length < 2) return '';
  return `^\\s*${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * Из найденных системой кнопок берём ту, что ближе всего к догадке ИИ.
 * Если догадки нет, берём только единственную кнопку с таким именем: иначе непонятно, какую показывать.
 */
export function pickNearest<T extends Named>(items: T[], guess: Box | null, name = '', maxDist = 260): T | null {
  const ok = items.filter((it) => it.w >= 4 && it.h >= 4 && it.w < 1600 && it.h < 900);
  if (!ok.length) return null;
  const want = name.replace(/[«»"“”]/g, '').trim().toLowerCase();
  const exact = ok.filter((it) => it.name.trim().toLowerCase() === want);
  const pool = exact.length ? exact : ok;
  if (!guess) return pool.length === 1 ? pool[0]! : null;
  const g = center(guess);
  let best: T | null = null;
  let bestD = Infinity;
  for (const it of pool) {
    const c = center(it);
    const d = Math.hypot(c.x - g.x, c.y - g.y);
    if (d < bestD) { best = it; bestD = d; }
  }
  return bestD <= maxDist ? best : null;
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
