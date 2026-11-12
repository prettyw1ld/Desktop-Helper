// Агент присутствия: регистрируется на сервере организации, раз в 45 секунд говорит «жив»
// и сразу сообщает о блокировке, сне и выходе. Работает только в корпоративном режиме
// с разделом presence в политике. Запросы — через net.fetch: системные сертификаты и прокси.
import { app, net, powerMonitor, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PolicyPresence } from './policy';
import { backoff, beat, BEAT_MS, deviceKey, parseMachineGuid, parseSid, type Beat, type Enroll, type Flags, type SleepReason } from './presence';

const flags: Flags = { locked: false, suspended: false };
let cfg: PolicyPresence | null = null;
let token = '';
let timer: NodeJS.Timeout | null = null;
let failures = 0;
let stopped = false;

const log = (...a: unknown[]) => console.log('presence:', ...a);
const tokenFile = () => path.join(app.getPath('userData'), 'presence.json');

function loadToken(url: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) as { url?: string; tokenEnc?: string };
    if (raw.url !== url || !raw.tokenEnc || !safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(raw.tokenEnc, 'base64'));
  } catch { return ''; }
}

function saveToken(url: string, t: string): void {
  try {
    // без шифрования токен не храним: зарегистрируемся заново при следующем запуске
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(tokenFile(), JSON.stringify({ url, tokenEnc: safeStorage.encryptString(t).toString('base64') }));
  } catch (e) { log('save token', String(e)); }
}

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout: 4000 }, (_e, out) => res(String(out || ''))));

async function identity(): Promise<{ machine: string; sid: string }> {
  if (process.platform === 'win32') {
    const [m, u] = await Promise.all([
      run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']),
      run('whoami', ['/user', '/fo', 'csv', '/nh']),
    ]);
    return { machine: parseMachineGuid(m) || os.hostname(), sid: parseSid(u) || os.userInfo().username };
  }
  if (process.platform === 'darwin') {
    const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    return { machine: /"IOPlatformUUID" = "([^"]+)"/.exec(out)?.[1] || os.hostname(), sid: String(os.userInfo().uid) };
  }
  let machine = '';
  try { machine = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch { /* нет — имя компьютера */ }
  return { machine: machine || os.hostname(), sid: String(os.userInfo().uid) };
}

async function post(pathname: string, body: unknown, auth = '', ms = 10_000): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!cfg) return { status: 0, json: {} };
  const res = await net.fetch(`${cfg.url}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json() as Record<string, unknown>; } catch { /* пустой ответ */ }
  return { status: res.status, json };
}

async function enroll(): Promise<boolean> {
  if (!cfg) return false;
  const id = await identity();
  const user = process.env.USERDOMAIN && process.platform === 'win32' ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username;
  const body: Enroll = {
    secret: cfg.secret,
    deviceKey: deviceKey(id.machine, id.sid, (s) => crypto.createHash('sha256').update(s).digest('hex')),
    host: os.hostname(),
    user,
    os: `${process.platform} ${os.release()}`,
    version: app.getVersion(),
  };
  const r = await post('/api/enroll', body);
  if (r.status !== 200 || typeof r.json.token !== 'string') { log('enroll failed', r.status); return false; }
  token = r.json.token;
  saveToken(cfg.url, token);
  log('enrolled');
  return true;
}

const idle = (): number => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } };

async function send(b: Beat, ms?: number): Promise<boolean> {
  if (!token && !(await enroll())) return false;
  const r = await post('/api/beat', b, token, ms);
  if (r.status === 401) {
    // устройство удалили на сервере или токен устарел: регистрируемся заново
    token = '';
    if (!(await enroll())) return false;
    return (await post('/api/beat', b, token, ms)).status === 200;
  }
  return r.status === 200;
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  if (!stopped) timer = setTimeout(() => { void tick('beat'); }, ms);
}

async function tick(kind: 'beat' | 'event', reason?: SleepReason): Promise<void> {
  let ok = false;
  try { ok = await send(beat(kind, flags, idle(), app.getVersion(), reason)); } catch (e) { log('send', String(e)); }
  failures = ok ? 0 : failures + 1;
  schedule(ok ? BEAT_MS : backoff(failures - 1));
}

function event(change: Partial<Flags>): void {
  Object.assign(flags, change);
  void tick('event');
}

/** Запуск: только если в политике есть presence. */
export function start(p: PolicyPresence | null): void {
  if (!p || cfg) return;
  cfg = p;
  stopped = false;
  token = loadToken(p.url);
  powerMonitor.on('lock-screen', () => event({ locked: true }));
  powerMonitor.on('unlock-screen', () => event({ locked: false }));
  powerMonitor.on('suspend', () => event({ suspended: true }));
  powerMonitor.on('resume', () => event({ suspended: false }));
  powerMonitor.on('shutdown', () => { void bye('shutdown'); });
  void tick('beat');
}

/** «Ушёл спать»: при выходе, выключении, завершении сеанса. Ждём не больше 1,5 с. */
export async function bye(reason: SleepReason): Promise<void> {
  if (!cfg || stopped) return;
  stopped = true;
  if (timer) clearTimeout(timer);
  try { await send(beat('bye', flags, idle(), app.getVersion(), reason), 1500); } catch { /* не успели — сервер сам заметит */ }
}

export const active = (): boolean => !!cfg && !stopped;
