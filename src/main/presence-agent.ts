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
import { accept, publicKey, scopesFor, type Bundle, type Payload } from './remote-config';
import { backoff, beat, BEAT_MS, deviceKey, parseMachineGuid, parseSid, type Beat, type Enroll, type Flags, type SleepReason } from './presence';

const flags: Flags = { locked: false, suspended: false };
let cfg: PolicyPresence | null = null;
let token = '';
let timer: NodeJS.Timeout | null = null;
let failures = 0;
let stopped = false;
let packIds: string[] = [];
let deviceId = '';
// настройки с сервера: принятые наборы и их версии (чтобы не откатить на старые)
let bundles: Bundle[] = [];
let seen: Record<string, number> = {};
let onConfig: (p: Payload[]) => void = () => {};
/** Кому отдавать проверенные настройки с сервера. */
export const setOnConfig = (fn: (p: Payload[]) => void): void => { onConfig = fn; };

const log = (...a: unknown[]) => console.log('presence:', ...a);
const tokenFile = () => path.join(app.getPath('userData'), 'presence.json');

function loadToken(url: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) as { url?: string; tokenEnc?: string; deviceId?: string };
    if (raw.url !== url || !raw.tokenEnc || !safeStorage.isEncryptionAvailable()) return '';
    deviceId = typeof raw.deviceId === 'string' ? raw.deviceId : '';
    return safeStorage.decryptString(Buffer.from(raw.tokenEnc, 'base64'));
  } catch { return ''; }
}

function saveToken(url: string, t: string): void {
  try {
    // без шифрования токен не храним: зарегистрируемся заново при следующем запуске
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(tokenFile(), JSON.stringify({ url, deviceId, tokenEnc: safeStorage.encryptString(t).toString('base64') }));
  } catch (e) { log('save token', String(e)); }
}

const configFile = () => path.join(app.getPath('userData'), 'remote-config.json');

/** Проверить наборы и, если что-то принято, отдать настройкам. Подпись проверяется каждый раз, и с диска тоже. */
function applyBundles(list: Bundle[]): boolean {
  if (!cfg) return false;
  const r = accept(list, publicKey(cfg.configKey ?? ''), scopesFor(cfg.group ?? '', deviceId), seen);
  for (const x of r.rejected) log('config rejected', x.scope, x.error);
  if (!r.payloads.length) return false;
  seen = r.seen;
  bundles = r.bundles;
  onConfig(r.payloads);
  return true;
}

function loadConfig(url: string): void {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as { url?: string; bundles?: Bundle[]; seen?: Record<string, number> };
    if (raw.url !== url) return;
    // версии помним даже без наборов: откатить на старый набор нельзя и после перезапуска
    seen = raw.seen && typeof raw.seen === 'object' ? raw.seen : {};
    applyBundles(Array.isArray(raw.bundles) ? raw.bundles : []);
  } catch { /* файла ещё нет */ }
}

function saveConfig(): void {
  try { fs.writeFileSync(configFile(), JSON.stringify({ url: cfg?.url, bundles, seen })); } catch (e) { log('save config', String(e)); }
}

/** Сервер сказал, какие версии у него есть: если новее наших — забираем и проверяем. */
async function pullConfig(offered: unknown): Promise<void> {
  if (!cfg?.configKey || !offered || typeof offered !== 'object') return;
  const newer = Object.entries(offered as Record<string, unknown>).some(([scope, v]) => typeof v === 'number' && v > (seen[scope] ?? 0));
  if (!newer) return;
  const r = await request('GET', '/api/config', undefined, token);
  if (r.status !== 200 || !Array.isArray(r.json.bundles)) return;
  if (applyBundles(r.json.bundles as Bundle[])) saveConfig();
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

const post = (pathname: string, body: unknown, auth = '', ms = 10_000) => request('POST', pathname, body, auth, ms);

async function request(method: 'GET' | 'POST', pathname: string, body: unknown, auth = '', ms = 10_000): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!cfg) return { status: 0, json: {} };
  const res = await net.fetch(`${cfg.url}${pathname}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
    ...(cfg.group ? { group: cfg.group } : {}),
    packs: packIds,
  };
  const r = await post('/api/enroll', body);
  if (r.status !== 200 || typeof r.json.token !== 'string') { log('enroll failed', r.status); return false; }
  token = r.json.token;
  deviceId = typeof r.json.deviceId === 'string' ? r.json.deviceId : '';
  saveToken(cfg.url, token);
  log('enrolled');
  return true;
}

const idle = (): number => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } };

let helloSent = false;

async function send(msg: Beat, ms?: number): Promise<boolean> {
  if (!token && !(await enroll())) return false;
  // первое сообщение после запуска несёт подразделение и пакеты: политика могла поменяться, а токен старый
  const first = helloSent ? msg : { ...msg, group: cfg?.group ?? '', packs: packIds };
  // какие версии настроек с сервера применены: админ видит это в карточке
  const b = { ...first, config: seen };
  let r = await post('/api/beat', b, token, ms);
  if (r.status === 401) {
    // устройство удалили на сервере или токен устарел: регистрируемся заново
    token = '';
    if (!(await enroll())) return false;
    r = await post('/api/beat', b, token, ms);
  }
  if (r.status !== 200) return false;
  helloSent = true;
  if (msg.kind !== 'bye') void pullConfig(r.json.config).catch((e: unknown) => log('config', String(e)));
  return true;
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
export function start(p: PolicyPresence | null, packs: string[] = []): void {
  if (!p || cfg) return;
  cfg = p;
  packIds = packs.slice(0, 10);
  stopped = false;
  token = loadToken(p.url);
  if (p.configKey) loadConfig(p.url);
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
