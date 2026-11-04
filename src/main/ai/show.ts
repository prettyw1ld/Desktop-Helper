// Показ на экране вместо текста: разбор ответов модели. Без electron, чтобы легко проверять в тестах.

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
export interface Mark { id: number; name: string; type: string; area: string; shot: Box; overlay: Box }

const AREA: Record<string, string> = { taskbar: 'taskbar', popup: 'start menu / popup', window: 'window', desktop: 'desktop icon, may be hidden under windows' };

/** Список для ИИ: «[3] Button "Поиск" (taskbar) at 110,500 size 210x40». */
export function formatMarks(marks: Mark[], max = 160): string {
  if (!marks.length) return 'No list of screen elements this time: point with "target" only.';
  const lines = marks.slice(0, max).map((m) => {
    const name = m.name.replace(/\s+/g, ' ').trim().slice(0, 60);
    return `[${m.id}] ${m.type} "${name}" (${AREA[m.area] ?? m.area}) at ${m.shot.x},${m.shot.y} size ${m.shot.w}x${m.shot.h}`;
  });
  return 'Screen elements found by the system (number, type, name, where; coordinates in screenshot pixels):\n'
    + `${lines.join('\n')}\nIf the thing to press is one of these, put its number into "elementId". `
    + 'Pick only what is really visible on the screenshot.';
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
  if (byId) return byId;
  const want = norm(name);
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
