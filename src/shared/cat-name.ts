// Имя кота: по умолчанию Пушик (Pushik), человек может дать своё. Общие для окна и главного процесса:
// очистка ввода, падежи для русских текстов («Спросить Барсика») и похожие слова для отклика на имя.

export const DEFAULT_CAT_NAME = { ru: 'Пушик', en: 'Pushik' } as const;
export const CAT_NAME_MAX = 20;

/** Только буквы, пробел и дефис, не длиннее 20 знаков. Пусто — имя по умолчанию. */
export function cleanCatName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[^\p{L}\s-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, CAT_NAME_MAX).trim();
}

/** Имя, которое показываем: своё или по умолчанию для языка. */
export const catNameFor = (name: unknown, lang: string): string =>
  cleanCatName(name) || DEFAULT_CAT_NAME[lang === 'en' ? 'en' : 'ru'];

type Case = 'gen' | 'dat' | 'ins';
const HUSH = 'жшчщц';

// Склонение одного слова как мужского имени животного: Пушик → Пушика, Пушику, Пушиком; Кузя → Кузи…
function declineWord(w: string, c: Case): string {
  const low = w.toLowerCase();
  if (!/[а-яё]$/.test(low) || w.length < 2) return w;
  const last = low.at(-1)!;
  const prev = low.at(-2)!;
  const ends = (stem: string, gen: string, dat: string, ins: string): string =>
    stem + (c === 'gen' ? gen : c === 'dat' ? dat : ins);
  if (low.endsWith('ок') && w.length > 3) return ends(`${w.slice(0, -2)}к`, 'а', 'у', 'ом'); // Снежок → Снежка
  if (low.endsWith('ёк') && w.length > 3) return ends(`${w.slice(0, -2)}ьк`, 'а', 'у', 'ом'); // Уголёк → Уголька
  if (last === 'й' || last === 'ь') return ends(w.slice(0, -1), 'я', 'ю', 'ем');
  if (last === 'а') return ends(w.slice(0, -1), 'гкхжшчщ'.includes(prev) ? 'и' : 'ы', 'е', HUSH.includes(prev) ? 'ей' : 'ой');
  if (last === 'я') return ends(w.slice(0, -1), 'и', 'е', 'ей');
  if ('аеёиоуыэю'.includes(last)) return w;  // Персико, Кики: не склоняются
  return ends(w, 'а', 'у', HUSH.includes(last) ? 'ем' : 'ом');
}

/** Имя в нужном падеже (для русских текстов). Латиницу и несклоняемые оставляем как есть. */
export const declineRu = (name: string, c: Case): string =>
  name.split(' ').map((w) => w.split('-').map((p) => declineWord(p, c)).join('-')).join(' ');

/** Подстановки для текстов: {cat}, {catGen}, {catDat}, {catIns}. */
export function catVars(name: unknown, lang: string): Record<'cat' | 'catGen' | 'catDat' | 'catIns', string> {
  const cat = catNameFor(name, lang);
  const ru = lang !== 'en';
  return {
    cat,
    catGen: ru ? declineRu(cat, 'gen') : cat,
    catDat: ru ? declineRu(cat, 'dat') : cat,
    catIns: ru ? declineRu(cat, 'ins') : cat,
  };
}

// ---------- отклик на имя ----------
// Модель распознавания знает около 250 тысяч слов. Если имени среди них нет (как «пушик»), она слышит похожие:
// «пушок», «пушки»… Их и ждём. Сравниваем «на слух»: щ=ш, о=а, без мягкого знака, оглушение в конце.

const LAT: Record<string, string> = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о',
  p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з',
};

/** Слово, которым зовут: первое слово имени, строчными, кириллицей (Pushik → пушик). */
export function callWord(name: string): string {
  const first = cleanCatName(name).toLowerCase().split(/[\s-]/)[0] ?? '';
  return first
    .replace(/sh/g, 'ш').replace(/ch/g, 'ч').replace(/zh/g, 'ж').replace(/ya/g, 'я').replace(/yu/g, 'ю').replace(/ts/g, 'ц')
    .replace(/[a-z]/g, (ch) => LAT[ch] ?? '')
    .replace(/ё/g, 'е');
}

const VOICED: Record<string, string> = { б: 'п', в: 'ф', г: 'к', д: 'т', ж: 'ш', з: 'с' };

/** Как слово звучит, грубо: чтобы «пушик» и «пушок» оказались рядом. */
export function sound(w: string): string {
  const s = w.toLowerCase().replace(/ё/g, 'е').replace(/щ/g, 'ш').replace(/[ьъ]/g, '')
    .replace(/о/g, 'а').replace(/э/g, 'е').replace(/я/g, 'а').replace(/ю/g, 'у').replace(/ы/g, 'и');
  const last = s.at(-1) ?? '';
  return VOICED[last] ? s.slice(0, -1) + VOICED[last] : s;
}

/** Расстояние Левенштейна: сколько букв поменять, вставить или убрать. */
export function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

const MAX_WORDS = 6;

// Для имени по умолчанию список подобран и проверен на записанной речи: модель слышит «Пушик» именно так.
const KNOWN: Record<string, string[]> = {
  пушик: ['пушок', 'пушки', 'пушкин', 'пушка', 'пушку', 'пушке'],
};

/**
 * Какие слова модели ждать, когда кота зовут по имени.
 * Имя есть в словаре — только оно. Нет — до шести самых похожих на слух слов, которые начинаются так же.
 * vocab — слова модели; пустой словарь (модели нет) — только известные списки.
 */
export function nameWords(name: string, vocab: Iterable<string>): string[] {
  const call = callWord(name);
  if (call.length < 2) return [];
  if (KNOWN[call]) return KNOWN[call];
  const want = sound(call);
  const maxD = call.length >= 5 ? 2 : 1;
  const found: { w: string; d: number }[] = [];
  for (const w of vocab) {
    if (w === call) return [call];
    if (Math.abs(w.length - call.length) > 2 || w[0] !== call[0] || !/^[а-яё]+$/.test(w)) continue;
    const s = sound(w);
    if (s.slice(0, 2) !== want.slice(0, 2)) continue;
    const d = distance(s, want);
    // при равном счёте ближе то, что кончается на тот же звук и той же длины
    if (d <= maxD) found.push({ w, d: d + (s.at(-1) === want.at(-1) ? 0 : 0.5) + Math.abs(w.length - call.length) * 0.1 });
  }
  return found.sort((a, b) => a.d - b.d || a.w.localeCompare(b.w)).slice(0, MAX_WORDS).map((x) => x.w);
}

/**
 * Частые слова, которые распознаватель имени тоже знает. Без них любая речь тянется к имени
 * («Сегодня хорошая погода» → «барсик»), с ними обычная фраза уходит в эти слова.
 * На записанной речи: ложных откликов стало в 5–10 раз меньше, а имя узнаётся как прежде.
 */
export const DECOY_WORDS = ('а и в не да нет что это как так вот ну я ты он она мы вы они там тут где когда сегодня завтра хорошо давай можно надо очень мне меня мой мои мама папа дом окно очки кошка кошки хвост привет чай хлеб есть был была будет купить сделать посмотреть открой включи позвони').split(' ');

/** Похоже ли короткое слово на конец имени: «Барсик» модель иногда дослышивает отдельным «пик». */
export function tailLike(word: string, name: string): boolean {
  const call = callWord(name);
  if (!word || word.length > 3 || call.length < 4) return false;
  return distance(sound(word), sound(call.slice(-word.length))) <= 1;
}

/** Похоже ли слово на имя (чтобы отрезать имя в начале просьбы). */
export function soundsLike(word: string, name: string): boolean {
  const call = callWord(name);
  if (!word || !call) return false;
  const a = sound(word);
  const b = sound(call);
  return a.slice(0, 2) === b.slice(0, 2) && distance(a, b) <= (call.length >= 5 ? 2 : 1);
}
