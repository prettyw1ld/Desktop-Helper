// Защита от мошенников без ИИ: замечаем программы удалённого доступа.
// Мошенники часто звонят от имени банка или полиции и просят поставить такую программу,
// чтобы управлять компьютером. Кот спокойно спрашивает, что происходит.
import { execFile } from 'node:child_process';

// Имя процесса (без .exe, в нижнем регистре) → понятное название программы.
const REMOTE_APPS: [RegExp, string][] = [
  [/^anydesk/, 'AnyDesk'],
  [/^teamviewer$/, 'TeamViewer'],
  [/^rustdesk/, 'RustDesk'],
  [/^rudesktop/, 'RuDesktop'],
  [/^(aa_v3|ammyy)/, 'Ammyy Admin'],
  [/^aeroadmin/, 'AeroAdmin'],
  [/^supremo/, 'Supremo'],
  [/^ultraviewer/, 'UltraViewer'],
  [/^getscreen/, 'Getscreen'],
  [/^rutserv$|^rfusclient$/, 'RMS (удалённый доступ)'],
  [/^romserver$/, 'LiteManager'],
  [/^quickassist$/, 'Быстрая помощь Windows'],
];

/** Какие программы удалённого доступа есть среди процессов. */
export function remoteApps(processes: string[]): string[] {
  const found = new Set<string>();
  for (const raw of processes) {
    const name = raw.trim().toLowerCase().replace(/\.(exe|app)$/, '');
    const hit = REMOTE_APPS.find(([re]) => re.test(name));
    if (hit) found.add(hit[1]);
  }
  return [...found];
}

/** Имена процессов из вывода tasklist /FO CSV /NH или ps -axco comm. */
export function parseProcessList(out: string, platform: NodeJS.Platform): string[] {
  const lines = out.split(/\r?\n/).filter(Boolean);
  if (platform === 'win32') return lines.map((l) => /^"([^"]+)"/.exec(l)?.[1] ?? '').filter(Boolean);
  return lines.map((l) => l.trim());
}

function listProcesses(): Promise<string[]> {
  const platform = process.platform;
  const [cmd, args] = platform === 'win32' ? ['tasklist', ['/FO', 'CSV', '/NH']] : ['ps', ['-axco', 'comm']];
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      resolve(err ? [] : parseProcessList(String(out), platform));
    });
  });
}

const EVERY_MS = 8000;
let timer: ReturnType<typeof setInterval> | null = null;
let seen = new Set<string>();

/** Сообщает о каждой программе, когда она появилась (и сразу, если уже запущена). */
export function start(onFound: (app: string) => void): void {
  stop();
  seen = new Set();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Set(remoteApps(await listProcesses()));
      for (const app of now) if (!seen.has(app)) onFound(app);
      seen = now;  // закрыли и открыли снова — спросим снова
    } finally { busy = false; }
  };
  timer = setInterval(() => { void tick(); }, EVERY_MS);
  setTimeout(() => { void tick(); }, 3000);
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
