// Журнал подсказок: сколько заняли снимок, список кнопок и ответ ИИ, куда в итоге показали.
// Нужен, чтобы по фактам разбирать «показал не туда» и «всё тормозит». Без снимков и без текста экрана.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 400;
let lines: string[] | null = null;

export const logFile = (): string => path.join(app.getPath('userData'), 'guide-log.txt');

export function guideLog(what: string, data: Record<string, unknown> = {}): void {
  try {
    if (!lines) {
      try { lines = fs.readFileSync(logFile(), 'utf8').split('\n').filter(Boolean).slice(-MAX_LINES); } catch { lines = []; }
    }
    const time = new Date().toISOString().replace('T', ' ').slice(0, 23);
    lines.push(`${time} ${what} ${JSON.stringify(data)}`);
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
    // пишем не сразу, а пачкой: запись на диск не должна тормозить подсказку
    if (!flushTimer) flushTimer = setTimeout(flush, 1500);
  } catch { /* журнал не важнее подсказки */ }
}

let flushTimer: NodeJS.Timeout | null = null;
function flush(): void {
  flushTimer = null;
  if (!lines) return;
  fs.promises.writeFile(logFile(), `${lines.join('\n')}\n`).catch(() => {});
}
