// Stop-хук: перед тем как закончить ответ, прогоняет typecheck и тесты Пушика.
// Красные проверки → код выхода 2, и их вывод уходит обратно агенту, чтобы он починил.
// Если правок в коде нет, ничего не запускает.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* пустой вход */ }

// Без зависимостей проверять нечем: не мешаем, просто молчим.
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) process.exit(0);

// Смотрим только незакоммиченные правки в том, что влияет на сборку и тесты.
const status = spawnSync(
  'git',
  ['status', '--porcelain', '--', 'src', 'test', 'tools', 'package.json', 'tsconfig.base.json', 'tsconfig.main.json', 'tsconfig.renderer.json', 'tsconfig.test.json'],
  { cwd: ROOT, encoding: 'utf8' },
);
if (status.status === 0 && !status.stdout.trim()) process.exit(0);

function run(script) {
  const r = spawnSync(`npm run ${script}`, { cwd: ROOT, encoding: 'utf8', shell: true });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const tail = (text, n) => text.split(/\r?\n/).filter((l) => !/^npm (notice|warn)/.test(l)).slice(-n).join('\n');

for (const [script, what] of [['typecheck', 'Проверка типов'], ['test', 'Тесты']]) {
  const r = run(script);
  if (r.ok) continue;
  const msg = `${what} (npm run ${script}) не проходят:\n\n${tail(r.out, 60)}`;
  if (input.stop_hook_active) {
    // Агент уже пытался починить после прошлого раза: отпускаем, но предупреждаем человека.
    console.log(JSON.stringify({ systemMessage: `Пушик: ${what.toLowerCase()} всё ещё не проходят, проверь npm run ${script}.` }));
    process.exit(0);
  }
  process.stderr.write(`${msg}\n\nПочини и прогони npm run typecheck и npm test ещё раз.\n`);
  process.exit(2);
}
process.exit(0);
