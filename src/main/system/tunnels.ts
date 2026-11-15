// Туннели во внешние сервисы: cloudflared, ngrok, ssh -R и им подобные открывают доступ к компьютеру
// из интернета в обход защиты компании. Их часто запускают ИИ-агенты (OpenCode, Claude Code, Cursor),
// когда им нужно «показать» запущенный сайт, — без спроса человека. Пушик замечает такой процесс,
// предупреждает и, если так велит политика, останавливает его. Только корпоративный режим.
// Распознавание — чистые функции без Electron, их проверяют тесты; запуск списков процессов — внизу.
import { execFile } from 'node:child_process';
import path from 'node:path';

export type TunnelAction = 'off' | 'warn' | 'stop';
export interface TunnelRules { action: TunnelAction; allow: RegExp[] }
/** Без раздела tunnels в политике кот предупреждает, но сам ничего не останавливает. */
export const DEFAULT_TUNNELS: TunnelRules = { action: 'warn', allow: [] };

export interface Proc { pid: number; ppid: number; name: string; cmd: string }
export interface Tunnel {
  pid: number;
  app: string;        // понятное название: «Cloudflare Tunnel», «SSH-туннель»
  cmd: string;        // командная строка без токенов и паролей
  chain: string[];    // кто запустил: [bash, opencode] — от ближнего к дальнему
}

/** Раздел tunnels политики: action — off / warn / stop, allow — регулярки разрешённых команд. */
export function parseTunnels(v: unknown): TunnelRules {
  if (!v || typeof v !== 'object') return { ...DEFAULT_TUNNELS };
  const o = v as Record<string, unknown>;
  const action: TunnelAction = o.action === 'off' || o.action === 'stop' ? o.action : 'warn';
  const allow: RegExp[] = [];
  for (const a of Array.isArray(o.allow) ? o.allow.slice(0, 20) : []) {
    if (typeof a !== 'string' || !a.trim() || a.length > 200) continue;
    try { allow.push(new RegExp(a, 'i')); } catch { /* плохая регулярка — пропускаем, остальные работают */ }
  }
  return { action, allow };
}

const base = (name: string): string => path.basename(name.trim().replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|app|cmd|bat|js|py)$/, '');

// Сама программа — туннель, что бы ей ни передали
const BY_NAME: [RegExp, string][] = [
  [/^cloudflared/, 'Cloudflare Tunnel'],
  [/^ngrok/, 'ngrok'],
  [/^frpc$/, 'frp'],
  [/^bore$/, 'bore'],
  [/^chisel/, 'chisel'],
  [/^rathole$/, 'rathole'],
  [/^zrok$/, 'zrok'],
  [/^devtunnel/, 'Microsoft Dev Tunnels'],
  [/^inlets/, 'inlets'],
  [/^loophole$/, 'Loophole'],
  [/^localtonet$/, 'Localtonet'],
  [/^playit/, 'playit.gg'],
  [/^pagekite/, 'PageKite'],
  [/^tunnelto$/, 'tunnelto'],
  [/^(lt|localtunnel)$/, 'localtunnel'],
];

// Сервисы, которые дают внешний адрес через обычный ssh
const SSH_HOSTS = /(serveo\.net|localhost\.run|pinggy\.(io|link)|srv\.us|tunnel\.pyjam\.as|ssh\.ngrok\.com)/i;
// -R (удалённый проброс: порт компьютера виден снаружи) и -D (SOCKS-прокси через чужой сервер), в том числе в связках -fNR
const SSH_FORWARD = /(^|\s)-[A-Za-z]*[RD]\s*\S/;

/** Программы, по имени которых не понять: нужна командная строка. */
const NEEDS_CMD = /^(ssh|plink|putty|node|npx|npm|pnpm|bun|bunx|deno|code|code-insiders|code-tunnel|tailscale|python\d*(\.\d+)?|pythonw|py)$/;

/** Стоит ли спрашивать командную строку этого процесса (дорого) или его имя уже всё говорит. */
export function suspicious(name: string): boolean {
  const n = base(name);
  return BY_NAME.some(([re]) => re.test(n)) || NEEDS_CMD.test(n);
}

/** Название туннеля, если процесс — туннель; иначе пусто. */
export function tunnelOf(p: Pick<Proc, 'name' | 'cmd'>): string {
  const n = base(p.name);
  const cmd = p.cmd || '';
  const hit = BY_NAME.find(([re]) => re.test(n));
  if (hit) return hit[1];
  if (/^(ssh|plink|putty)$/.test(n)) {
    if (SSH_HOSTS.test(cmd)) return 'SSH-туннель во внешний сервис';
    if (SSH_FORWARD.test(cmd.replace(/^"[^"]*"|^\S+/, ''))) return 'SSH-туннель';
    return '';
  }
  if (/^(node|npx|npm|pnpm|bun|bunx|deno)$/.test(n)) {
    if (/\bcloudflared\b|\buntun\b/i.test(cmd)) return 'Cloudflare Tunnel';
    if (/\bngrok\b/i.test(cmd)) return 'ngrok';
    if (/\blocaltunnel\b|[\\/\s]lt(\.cmd|\.js)?\s+(--port|-p)\b/i.test(cmd)) return 'localtunnel';
    return '';
  }
  if (/^(code|code-insiders|code-tunnel)$/.test(n)) return /\stunnel(\s|$)/i.test(cmd) && !/--type=/.test(cmd) ? 'VS Code Tunnel' : '';
  if (n === 'tailscale') return /\s(funnel)(\s|$)/i.test(cmd) ? 'Tailscale Funnel' : '';
  if (/^(python\d*(\.\d+)?|pythonw|py)$/.test(n)) return /pagekite/i.test(cmd) ? 'PageKite' : '';
  return '';
}

/** Командная строка для журнала: токены, ключи и пароли закрыты, не длиннее 300 знаков. */
export function maskCmd(cmd: string): string {
  return String(cmd || '')
    .replace(/(--?(?:token|authtoken|auth-token|key|secret|password|pass|cred\w*)[=\s]+)("[^"]*"|\S+)/gi, '$1[скрыто]')
    .replace(/(\b(?:authtoken|token)\s+(?:add\s+)?)(?!\[скрыто\])\S{12,}/gi, '$1[скрыто]')
    // длинные строки похожи на ключи; GUID и обычные пути с ним — нет
    .replace(/[A-Za-z0-9_\-+=]{32,}/g, (m) => (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(m) ? m : '[скрыто]'))
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Кто запустил процесс: имена родителей, ближний первым, без повторов подряд, до 4. */
export function parentChain(procs: Proc[], pid: number): string[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const out: string[] = [];
  let cur = byPid.get(pid);
  const seen = new Set<number>([pid]);
  while (cur && out.length < 4) {
    const parent = byPid.get(cur.ppid);
    if (!parent || seen.has(parent.pid)) break;
    seen.add(parent.pid);
    const n = base(parent.name);
    if (out[out.length - 1] !== n) out.push(n);
    cur = parent;
  }
  return out;
}

/** Туннели среди процессов pids (новых), кроме разрешённых политикой. */
export function findTunnels(procs: Proc[], pids: Set<number>, rules: TunnelRules, self = process.pid): Tunnel[] {
  const res: Tunnel[] = [];
  for (const p of procs) {
    if (!pids.has(p.pid) || p.pid === self) continue;
    const app = tunnelOf(p);
    if (!app) continue;
    if (rules.allow.some((re) => re.test(p.cmd) || re.test(p.name))) continue;
    res.push({ pid: p.pid, app, cmd: maskCmd(p.cmd || p.name), chain: parentChain(procs, p.pid) });
  }
  return res;
}

// ---------- Списки процессов ----------

/** tasklist /FO CSV /NH → [имя, pid]. */
export function parseTasklist(out: string): { name: string; pid: number }[] {
  const res: { name: string; pid: number }[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m) res.push({ name: m[1]!, pid: Number(m[2]) });
  }
  return res;
}

/** Вывод Get-CimInstance Win32_Process | ConvertTo-Json → процессы (один процесс PowerShell отдаёт объектом). */
export function parseCim(out: string): Proc[] {
  let raw: unknown;
  try { raw = JSON.parse(out.replace(/^﻿/, '')); } catch { return []; }
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.flatMap((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const pid = Number(o.ProcessId);
    if (!Number.isInteger(pid)) return [];
    return [{ pid, ppid: Number(o.ParentProcessId) || 0, name: String(o.Name ?? ''), cmd: String(o.CommandLine ?? '') }];
  });
}

/** ps -axww -o pid=,ppid=,args= → процессы (macOS, Linux). */
export function parsePs(out: string): Proc[] {
  const res: Proc[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const cmd = m[3]!.trim();
    res.push({ pid: Number(m[1]), ppid: Number(m[2]), name: cmd.split(/\s+/)[0] ?? '', cmd });
  }
  return res;
}

const run = (cmd: string, args: string[], timeout: number): Promise<string> => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, out) => resolve(err ? '' : String(out)));
});

const CIM = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress';

/** Все процессы с командной строкой и родителем. На Windows это заметно дороже tasklist: вызываем только по делу. */
export async function fullList(): Promise<Proc[]> {
  if (process.platform === 'win32') return parseCim(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', CIM], 15000));
  return parsePs(await run('ps', ['-axww', '-o', 'pid=,ppid=,args='], 5000));
}

/** Дешёвый список: имя и pid. На macOS и Linux ps сразу даёт и командную строку. */
async function quickList(): Promise<{ name: string; pid: number }[]> {
  if (process.platform === 'win32') return parseTasklist(await run('tasklist', ['/FO', 'CSV', '/NH'], 5000));
  return (await fullList()).map((p) => ({ name: p.name, pid: p.pid }));
}

const EVERY_MS = 6000;
let timer: ReturnType<typeof setInterval> | null = null;
let checked = new Set<number>();

/**
 * Раз в 6 с смотрим список процессов. Новый процесс с подозрительным именем — один раз спрашиваем
 * командные строки и родителей и сообщаем о туннелях. Уже запущенные при старте Пушика тоже находим.
 */
export function start(rules: TunnelRules, onFound: (t: Tunnel) => void): void {
  stop();
  if (rules.action === 'off') return;
  checked = new Set();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const quick = await quickList();
      if (!quick.length) return;
      const alive = new Set(quick.map((p) => p.pid));
      for (const pid of checked) if (!alive.has(pid)) checked.delete(pid);
      const fresh = new Set(quick.filter((p) => !checked.has(p.pid) && suspicious(p.name)).map((p) => p.pid));
      for (const p of quick) checked.add(p.pid);
      if (!fresh.size) return;
      const procs = await fullList();
      // командные строки не получили (PowerShell занят или запрещён): проверим эти процессы в следующий раз
      if (!procs.length) { for (const pid of fresh) checked.delete(pid); return; }
      for (const t of findTunnels(procs, fresh, rules)) onFound(t);
    } finally { busy = false; }
  };
  timer = setInterval(() => { void tick(); }, EVERY_MS);
  setTimeout(() => { void tick(); }, 4000);
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
