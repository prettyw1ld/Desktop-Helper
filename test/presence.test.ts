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
