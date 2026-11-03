// Сборка Пушика в build/:
//   main.js     главный процесс (src/main)
//   preload.js  мост между окном кота и главным процессом (src/preload)
//   renderer/   окно кота: renderer.js (src/renderer) + index.html и стили
//   test/       тесты (test/*.test.ts), только с флагом --tests
//
// node tools/build.mts            собрать приложение
// node tools/build.mts --watch    пересобирать при изменениях
// node tools/build.mts --tests    собрать и тесты
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'build');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const common: esbuild.BuildOptions = {
  bundle: true,
  sourcemap: 'linked',
  logLevel: 'info',
  charset: 'utf8',
};

const configs: esbuild.BuildOptions[] = [
  {
    ...common,
    entryPoints: [path.join(ROOT, 'src/main/main.ts')],
    outfile: path.join(OUT, 'main.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // зависимости остаются в node_modules: electron-builder кладёт их в установщик
    external: ['electron', 'node-ical'],
  },
  {
    ...common,
    entryPoints: [path.join(ROOT, 'src/preload/preload.ts')],
    outfile: path.join(OUT, 'preload.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: [path.join(ROOT, 'src/renderer/main.ts')],
    outfile: path.join(OUT, 'renderer/renderer.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  },
];

if (tests) {
  const dir = path.join(ROOT, 'test');
  configs.push({
    ...common,
    entryPoints: fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(dir, f)),
    outdir: path.join(OUT, 'test'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'node-ical', 'happy-dom', '@happy-dom/global-registrator'],
  });
}

// Разметка и стили окна кота лежат рядом с кодом и копируются как есть.
function copyStatic(): void {
  const from = path.join(ROOT, 'src/renderer');
  const to = path.join(OUT, 'renderer');
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    if (/\.(html|css)$/.test(f)) fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
}

const copyPlugin: esbuild.Plugin = {
  name: 'copy-static',
  setup(build) { build.onEnd(() => copyStatic()); },
};

if (watch) {
  configs[2]!.plugins = [copyPlugin];
  for (const c of configs) await (await esbuild.context(c)).watch();
  console.log('[pushik] watching for changes…');
} else {
  fs.rmSync(OUT, { recursive: true, force: true });
  await Promise.all(configs.map((c) => esbuild.build(c)));
  copyStatic();
}
