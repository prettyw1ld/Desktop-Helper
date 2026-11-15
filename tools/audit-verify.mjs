// Проверка журнала Пушика: не вырезаны ли и не изменены ли строки.
//   node tools/audit-verify.mjs "%APPDATA%\Пушик\audit.1.log" "%APPDATA%\Пушик\audit.log"
// Файлы — по порядку, от старого к новому. Каждая строка хранит sha256 предыдущей в поле prev.
import crypto from 'node:crypto';
import fs from 'node:fs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const files = process.argv.slice(2);
if (!files.length) { console.error('укажи файлы журнала от старого к новому'); process.exit(2); }
const lines = files.flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((text, n) => ({ f, n: n + 1, text })));
let bad = 0;
for (let i = 1; i < lines.length; i++) {
  let prev;
  try { prev = JSON.parse(lines[i].text).prev; } catch { prev = null; }
  // строки старых версий без prev пропускаем: цепочка начинается с первой строки, где он есть
  if (prev === undefined) continue;
  if (prev !== sha(lines[i - 1].text)) { bad++; console.log(`разрыв: ${lines[i].f}:${lines[i].n}`); }
}
console.log(bad ? `найдено разрывов: ${bad}` : `цепочка цела: ${lines.length} строк`);
process.exit(bad ? 1 : 0);
