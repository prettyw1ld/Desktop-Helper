// Присутствие: состояние кота у агента и сервер, который показывает его админ-панели.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parsePolicy, parsePresence, regToRaw } from '../src/main/policy';
import { backoff, beat, deviceKey, moodOf, parseMachineGuid, parseSid } from '../src/main/presence';

const SECRET = 'enroll-secret-0123456789';
const ADMIN = 'admin-password-42';

test('mood: lock and sleep put the cat to sleep, five idle minutes make it doze', () => {
  assert.deepEqual(moodOf({ locked: false, suspended: false }, 10), { mood: 'awake', reason: '' });
  assert.deepEqual(moodOf({ locked: false, suspended: false }, 300), { mood: 'dozing', reason: '' });
  assert.deepEqual(moodOf({ locked: true, suspended: false }, 0), { mood: 'asleep', reason: 'lock' });
  assert.deepEqual(moodOf({ locked: true, suspended: true }, 0), { mood: 'asleep', reason: 'suspend' });
  assert.deepEqual(beat('bye', { locked: false, suspended: false }, 3.6, '1.0', 'logoff'), { kind: 'bye', mood: 'asleep', reason: 'logoff', idleSec: 4, version: '1.0' });
  assert.equal(beat('bye', { locked: false, suspended: false }, 0, '1.0').reason, 'quit');
});

test('backoff grows to five minutes and spreads the cats apart', () => {
  assert.equal(backoff(0, () => 0.5), 2000);
  assert.equal(backoff(3, () => 0.5), 16000);
  assert.equal(backoff(50, () => 0.5), 300000);
  assert.equal(backoff(50, () => 0), 240000);
  assert.equal(backoff(50, () => 1), 360000);
});

test('device key hides the machine GUID and the SID', () => {
  const hash = (s: string) => `h(${s})`;
  assert.equal(deviceKey(' ABC-1 ', 's-1-5-21-1', hash), 'h(pushik:abc-1:S-1-5-21-1)');
  assert.equal(parseMachineGuid('\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    3f2504e0-4f89-11d3-9a0c-0305e82c3301\r\n'), '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  assert.equal(parseSid('"corp\\anna","S-1-5-21-111-222-333-1001"\r\n'), 'S-1-5-21-111-222-333-1001');
  assert.equal(parseSid('error'), '');
});

test('policy presence needs https and a long secret; a bad one switches presence off only', () => {
  assert.deepEqual(parsePresence({ url: 'https://pushik.corp/', secret: SECRET }), { url: 'https://pushik.corp', secret: SECRET });
  assert.equal(parsePresence({ url: 'http://pushik.corp', secret: SECRET }), null);
  assert.deepEqual(parsePresence({ url: 'http://pushik.corp', secret: SECRET, allowHttp: true }), { url: 'http://pushik.corp', secret: SECRET });
  assert.equal(parsePresence({ url: 'https://pushik.corp', secret: 'short' }), null);
  const p = parsePolicy({ org: 'ИБ', presence: { url: 'https://pushik.corp', secret: SECRET } });
  assert.equal(p.presence?.url, 'https://pushik.corp');
  assert.equal(parsePolicy({ ai: 'broken', presence: { url: 'https://pushik.corp', secret: SECRET } }).presence?.url, 'https://pushik.corp');
  assert.deepEqual(regToRaw({ PresenceUrl: 'https://p.corp', PresenceSecret: SECRET })?.presence, { url: 'https://p.corp', secret: SECRET, allowHttp: false });
});

// ---------- сервер ----------

interface Store { list(): Promise<{ id: string }[]> }
type App = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function server(now: () => number): Promise<{ base: string; store: Store; close: () => void }> {
  const root = path.join(__dirname, '../../server');
  const { createApp } = await import(pathToFileURL(path.join(root, 'app.mjs')).href) as { createApp: (o: object) => App };
  const { memoryStore } = await import(pathToFileURL(path.join(root, 'store-memory.mjs')).href) as { memoryStore: () => Store };
  const store = memoryStore();
  const srv = http.createServer(createApp({ store, enrollSecret: SECRET, adminPassword: ADMIN, now }));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, store, close: () => srv.close() };
}

const json = (body: unknown, auth = '') => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  body: JSON.stringify(body),
});
const basic = (pw: string) => ({ headers: { authorization: `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}` } });
const KEY = 'a'.repeat(64);

test('server: enroll, beat, list with statuses, forget', async () => {
  let t = 1_000_000;
  const s = await server(() => t);
  try {
    assert.equal((await fetch(`${s.base}/api/enroll`, json({ secret: 'wrong-secret-0000000', deviceKey: KEY }))).status, 403);
    assert.equal((await fetch(`${s.base}/api/enroll`, json({ secret: SECRET, deviceKey: 'nothex' }))).status, 400);
    const e = await (await fetch(`${s.base}/api/enroll`, json({ secret: SECRET, deviceKey: KEY, host: 'PC-042', user: 'CORP\\anna', os: 'win32 10', version: '0.9.0' }))).json() as { token: string; deviceId: string };
    assert.ok(e.token.length > 30);
    // повторная регистрация того же устройства: то же устройство, новый токен, старый больше не работает
    const e2 = await (await fetch(`${s.base}/api/enroll`, json({ secret: SECRET, deviceKey: KEY, host: 'PC-042' }))).json() as { token: string; deviceId: string };
    assert.equal(e2.deviceId, e.deviceId);
    assert.equal((await fetch(`${s.base}/api/beat`, json({ mood: 'awake' }, e.token))).status, 401);
    assert.equal((await fetch(`${s.base}/api/beat`, json({ mood: 'asleep', reason: 'lock', idleSec: 12 }, e2.token))).status, 200);

    assert.equal((await fetch(`${s.base}/api/devices`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/devices`, basic('nope'))).status, 401);
    let list = await (await fetch(`${s.base}/api/devices`, basic(ADMIN))).json() as { counts: Record<string, number>; devices: { status: string; reason: string; host: string }[] };
    assert.deepEqual(list.counts, { awake: 0, dozing: 0, asleep: 1, lost: 0, offline: 0 });
    assert.equal(list.devices[0]!.reason, 'lock');
    assert.equal(list.devices[0]!.host, 'PC-042');

    await fetch(`${s.base}/api/beat`, json({ mood: 'dozing', reason: 'lock', idleSec: 400 }, e2.token));
    t += 200_000; // три пропуска — потерялся
    list = await (await fetch(`${s.base}/api/devices`, basic(ADMIN))).json() as typeof list;
    assert.equal(list.devices[0]!.status, 'lost');
    assert.equal(list.devices[0]!.reason, '');
    t += 4_000_000;
    list = await (await fetch(`${s.base}/api/devices`, basic(ADMIN))).json() as typeof list;
    assert.equal(list.devices[0]!.status, 'offline');

    const page = await fetch(`${s.base}/`, basic(ADMIN));
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.equal((await fetch(`${s.base}/`)).headers.get('www-authenticate'), 'Basic realm="Pushik", charset="UTF-8"');

    assert.equal((await fetch(`${s.base}/api/devices/${e.deviceId}`, { method: 'DELETE', ...basic(ADMIN) })).status, 200);
    assert.equal((await fetch(`${s.base}/api/beat`, json({ mood: 'awake' }, e2.token))).status, 401);
    assert.equal((await s.store.list()).length, 0);
  } finally { s.close(); }
});

test('server: refuses big bodies, non-JSON and too many enrolls', async () => {
  const s = await server(() => Date.now());
  try {
    assert.equal((await fetch(`${s.base}/api/enroll`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
    const big = await fetch(`${s.base}/api/enroll`, json({ secret: SECRET, deviceKey: KEY, pad: 'x'.repeat(20000) })).catch(() => null);
    assert.ok(!big || big.status === 413);
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await fetch(`${s.base}/api/enroll`, json({ secret: SECRET, deviceKey: KEY }))).status;
    assert.equal(last, 429);
  } finally { s.close(); }
});

test('server: department, packs and a 7-day history card', async () => {
  let t = 10 * 86400_000;
  const s = await server(() => t);
  try {
    const e = await (await fetch(`${s.base}/api/enroll`, json({ secret: SECRET, deviceKey: KEY, host: 'PC-001', group: ' Отдел ИБ ', packs: ['security', 'Bad Id', 7] }))).json() as { token: string; deviceId: string };
    type Card = { since: number; device: { group: string; packs: string[]; status: string }; history: { at: number; mood: string; reason: string }[] };
    const card = async () => await (await fetch(`${s.base}/api/devices/${e.deviceId}`, basic(ADMIN))).json() as Card;
    let c = await card();
    assert.equal(c.device.group, 'Отдел ИБ');
    assert.deepEqual(c.device.packs, ['security']);
    assert.deepEqual(c.history.map((h) => h.mood), ['awake']);

    t += 3600_000;
    await fetch(`${s.base}/api/beat`, json({ mood: 'asleep', reason: 'lock' }, e.token));
    await fetch(`${s.base}/api/beat`, json({ mood: 'asleep', reason: 'lock' }, e.token)); // то же состояние — не событие
    t += 8 * 86400_000;
    // после перезапуска Пушик сообщает новое подразделение и пакеты тем же токеном
    await fetch(`${s.base}/api/beat`, json({ mood: 'awake', group: 'Бухгалтерия', packs: [] }, e.token));
    c = await card();
    assert.equal(c.device.group, 'Бухгалтерия');
    assert.deepEqual(c.device.packs, []);
    // старше 7 дней остаётся одна запись — с неё начинается полоса; её время прижато к началу окна
    assert.deepEqual(c.history.map((h) => [h.mood, h.reason]), [['asleep', 'lock'], ['awake', '']]);
    assert.equal(c.history[0]!.at, c.since);
    const list = await (await fetch(`${s.base}/api/devices`, basic(ADMIN))).json() as { devices: { group: string; packs: string[] }[] };
    assert.equal(list.devices[0]!.group, 'Бухгалтерия');

    assert.equal((await fetch(`${s.base}/api/devices/${e.deviceId}`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/devices/00000000-0000-0000-0000-000000000000`, basic(ADMIN))).status, 404);
  } finally { s.close(); }
});

test('policy presence carries the department', () => {
  assert.deepEqual(parsePresence({ url: 'https://p.corp', secret: SECRET, group: 'Отдел ИБ' }), { url: 'https://p.corp', secret: SECRET, group: 'Отдел ИБ' });
  assert.deepEqual(regToRaw({ PresenceUrl: 'https://p.corp', PresenceSecret: SECRET, PresenceGroup: 'ИБ' })?.presence, { url: 'https://p.corp', secret: SECRET, allowHttp: false, group: 'ИБ' });
});

// ---------- единый вход через прокси, роли и журнал администраторов ----------

const PROXY = 'proxy-secret-0123456789';
async function ssoServer(): Promise<{ base: string; close: () => void; logged: unknown[] }> {
  const root = path.join(__dirname, '../../server');
  const { createApp } = await import(pathToFileURL(path.join(root, 'app.mjs')).href) as { createApp: (o: object) => App };
  const { memoryStore } = await import(pathToFileURL(path.join(root, 'store-memory.mjs')).href) as { memoryStore: () => Store };
  const logged: unknown[] = [];
  const srv = http.createServer(createApp({
    store: memoryStore(), enrollSecret: SECRET, now: () => 1_000_000, log: (e: unknown) => logged.push(e),
    proxyAuth: { secret: PROXY, viewGroups: 'soc-view', configGroups: 'soc-admins' },
  }));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close(), logged };
}
const sso = (user: string, groups: string, secret = PROXY) => ({ 'x-pushik-proxy-secret': secret, 'x-auth-request-preferred-username': user, 'x-auth-request-groups': groups });

test('server: single sign-on through the proxy with view and config roles', async () => {
  const s = await ssoServer();
  try {
    // без прокси (пароля нет) и с чужим секретом — не пускает; подставить заголовки в обход nginx нельзя
    assert.equal((await fetch(`${s.base}/api/devices`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/devices`, { headers: sso('ivan', 'soc-admins', 'wrong-secret-000000000') })).status, 401);
    assert.equal((await fetch(`${s.base}/api/devices`, { headers: sso('petr', 'accounting') })).status, 403);
    assert.deepEqual(await (await fetch(`${s.base}/api/me`, { headers: sso('anna', 'domain users,soc-view') })).json(), { name: 'anna', role: 'view' });
    assert.equal((await fetch(`${s.base}/api/devices`, { headers: sso('anna', 'soc-view') })).status, 200);
    // смотреть может, менять — нет
    const bundle = { payload: JSON.stringify({ v: 1, scope: 'global', version: 1, settings: {} }), sig: 'x' };
    const put = (h: Record<string, string>) => fetch(`${s.base}/api/config`, { method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(bundle) });
    assert.equal((await put(sso('anna', 'soc-view'))).status, 403);
    assert.equal((await put(sso('ivan', 'soc-admins'))).status, 200);
    const log = await (await fetch(`${s.base}/api/admin-log`, { headers: sso('anna', 'soc-view') })).json() as { entries: { who: string; action: string; target: string; detail: string }[] };
    assert.deepEqual(log.entries.map((e) => [e.who, e.action, e.target, e.detail]), [['ivan', 'config.put', 'global', 'v1']]);
    assert.deepEqual(s.logged.map((e) => (e as { event: string; who: string }).who), ['ivan']);
  } finally { s.close(); }
});

test('server: every config version is kept for diff and rollback', async () => {
  const s = await server(() => 5_000);
  try {
    const put = (version: number, settings: object) => fetch(`${s.base}/api/config`, {
      method: 'PUT', headers: { ...basic(ADMIN).headers, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: JSON.stringify({ v: 1, scope: 'group:ИБ', version, settings }), sig: 's' }),
    });
    assert.equal((await put(1, { screenshots: 'window' })).status, 200);
    assert.equal((await put(2, { screenshots: 'off' })).status, 200);
    assert.equal((await put(2, { screenshots: 'screen' })).status, 409);
    const h = await (await fetch(`${s.base}/api/config-history?scope=${encodeURIComponent('group:ИБ')}`, basic(ADMIN))).json() as { versions: { version: number; settings: { screenshots: string }; payload: string }[] };
    assert.deepEqual(h.versions.map((v) => [v.version, v.settings.screenshots]), [[2, 'off'], [1, 'window']]);
    assert.ok(h.versions[1]!.payload.includes('"version":1'));
    assert.equal((await fetch(`${s.base}/api/config-history?scope=bad`, basic(ADMIN))).status, 400);
  } finally { s.close(); }
});
