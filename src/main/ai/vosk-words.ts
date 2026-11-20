// Слова, которые знает офлайн-модель Vosk. Нужны, чтобы кот откликался на своё имя, даже новое:
// имя есть в словаре — ждём его, нет — ждём похожие на слух слова (см. nameWords в shared/cat-name.ts).
// Словарь лежит внутри архива модели: таблица слов в graph/Gr.fst (маленькие модели) или graph/words.txt.
// Читаем архив по запросу и не держим в памяти: имя меняют редко.
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { nameWords } from '../../shared/cat-name';
import { VOSK_MODEL } from '../paths';

const gunzip = promisify(zlib.gunzip);

/** Файлы из tar: имя → содержимое. Берём только нужные, служебные «._» от macOS пропускаем. */
export function untar(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let o = 0;
  while (o + 512 <= buf.length) {
    const name = buf.toString('utf8', o, o + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(buf.toString('ascii', o + 124, o + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const start = o + 512;
    if (!name.split('/').pop()!.startsWith('._') && want(name)) out.set(name, buf.subarray(start, start + size));
    o = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

const SYMBOLS_MAGIC = 2125658996;

/** Таблица слов из бинарного графа OpenFst: ищем её по «магическому» числу и читаем записи «длина, слово, номер». */
export function fstWords(buf: Buffer): string[] {
  const magic = Buffer.alloc(4);
  magic.writeInt32LE(SYMBOLS_MAGIC);
  let o = buf.indexOf(magic);
  if (o < 0) return [];
  o += 4;
  const str = (): string => { const n = buf.readInt32LE(o); o += 4; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  str();                                   // имя таблицы
  o += 8;                                  // следующий свободный номер
  const count = Number(buf.readBigInt64LE(o)); o += 8;
  const words: string[] = [];
  for (let i = 0; i < count && o < buf.length; i++) { words.push(str()); o += 8; }
  return words;
}

async function readVocab(): Promise<string[]> {
  const files = untar(await gunzip(await fs.readFile(VOSK_MODEL)), (n) => /(^|\/)graph\/(Gr\.fst|words\.txt)$/.test(n));
  for (const [name, data] of files) {
    if (name.endsWith('words.txt')) return data.toString('utf8').split('\n').map((l) => l.split(' ')[0] ?? '');
  }
  for (const data of files.values()) return fstWords(data);
  return [];
}

let last: { name: string; words: string[] } | null = null;

/** Какие слова ждать, когда зовут по имени. Нет модели — то, что известно без неё. */
export async function wordsForName(name: string): Promise<string[]> {
  if (last?.name === name) return last.words;
  let vocab: string[] = [];
  try { vocab = await readVocab(); } catch { /* модели нет или архив другой */ }
  const words = nameWords(name, vocab);
  last = { name, words };
  return words;
}
