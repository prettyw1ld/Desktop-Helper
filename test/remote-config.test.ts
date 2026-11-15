// Настройки с сервера (E-36/E-37): подпись, адресат, без отката, и только ужесточение политики.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { accept, publicKey, scopesFor, tighten, verify, type Bundle, type Tunable } from '../src/main/remote-config';
import { parsePresence } from '../src/main/policy';

const pair = crypto.generateKeyPairSync('ed25519');
const RAW = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const KEY = publicKey(RAW);
const sign = (scope: string, version: number, settings: unknown, key = pair.privateKey): Bundle => {
  const payload = JSON.stringify({ v: 1, scope, version, issuedAt: 1, settings });
  return { payload, sig: crypto.sign(null, Buffer.from(payload), key).toString('base64') };
};
const BASE: Tunable = {
  features: { chat: true, guide: true, inspect: true },
  privacy: { screenshots: 'window', denyApps: ['keepass'], masks: [] },
  answers: { allowHosts: ['corp.local', 'wiki.corp.local'] },
};

test('only a bundle signed with the policy key is accepted', () => {
  assert.ok(KEY);
  assert.equal(publicKey('short'), null);
  assert.ok(publicKey(pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()));
  const good = sign('global', 1, { features: { chat: false } });
  assert.equal((verify(good, KEY) as { version: number }).version, 1);
  // чужой ключ, подменённое содержимое, нет ключа в политике
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.deepEqual(verify(sign('global', 1, {}, other), KEY), { error: 'signature' });
  assert.deepEqual(verify({ ...good, payload: good.payload.replace('false', 'true') }, KEY), { error: 'signature' });
  assert.deepEqual(verify(good, null), { error: 'no key' });
});

test('wrong addressee and older versions are refused', () => {
  const scopes = scopesFor('Отдел ИБ', 'd1');
  assert.deepEqual(scopes, ['global', 'group:Отдел ИБ', 'device:d1']);
  const r = accept([sign('group:Бухгалтерия', 5, {}), sign('global', 2, {}), sign('global', 3, {}), sign('device:d1', 1, {})], KEY, scopes, { 'device:d1': 4 });
  assert.deepEqual(r.payloads.map((p) => `${p.scope}@${p.version}`), ['global@3']);
  assert.deepEqual(r.rejected.map((x) => x.error).sort(), ['not for me', 'rollback']);
  assert.deepEqual(r.seen, { global: 3, 'device:d1': 4 });
  assert.equal(r.bundles.length, 1);
});

test('a bundle can only make the policy stricter', () => {
  const p = accept([
    sign('global', 1, { features: { chat: false, guide: true }, privacy: { screenshots: 'screen', denyApps: ['1cv8'], masks: ['ТН-\\d{6}'] } }),
    sign('group:ИБ', 1, { privacy: { screenshots: 'off' }, answers: { allowHosts: ['corp.local', 'evil.example'] } }),
  ], KEY, scopesFor('ИБ', ''), {}).payloads;
  const t = tighten(BASE, p);
  assert.deepEqual(t.features, { chat: false, guide: true, inspect: true }, 'turning a feature on is ignored');
  assert.equal(t.privacy.screenshots, 'off');
  assert.deepEqual(t.privacy.denyApps, ['keepass', '1cv8']);
  assert.deepEqual(t.privacy.masks, ['ТН-\\d{6}']);
  assert.deepEqual(t.answers.allowHosts, ['corp.local'], 'a new host is not added to the policy list');
  // политика без списка ссылок: сервер может его ввести
  assert.deepEqual(tighten({ ...BASE, answers: { allowHosts: null } }, p).answers.allowHosts, ['corp.local', 'evil.example']);
  // «screen» мягче «window» — не применяется
  assert.equal(tighten(BASE, p.slice(0, 1)).privacy.screenshots, 'window');
});

test('policy presence carries the config key', () => {
  assert.equal(parsePresence({ url: 'https://pushik.corp', secret: 'x'.repeat(16), configKey: RAW })?.configKey, RAW);
});

test('server: stores signed bundles, refuses unsigned and older ones, hands them to the device', async () => {
  const root = path.join(__dirname, '../../server');
  const { createApp } = await import(pathToFileURL(path.join(root, 'app.mjs')).href) as { createApp: (o: object) => http.RequestListener };
  const { memoryStore } = await import(pathToFileURL(path.join(root, 'store-memory.mjs')).href) as { memoryStore: () => object };
  // ключ и подпись — тем же инструментом, что у администратора
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pushik-sign-'));
  const tool = path.join(root, 'tools', 'config-sign.mjs');
  const keyFile = path.join(dir, 'key.pem');
  const pub = execFileSync(process.execPath, [tool, 'keygen', keyFile], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify({ features: { chat: false } }));
  const signed = (scope: string, v: number) => execFileSync(process.execPath, [tool, 'sign', keyFile, path.join(dir, 's.json'), scope, String(v)], { encoding: 'utf8' }).trim();

  const srv = http.createServer(createApp({ store: memoryStore(), enrollSecret: 'enroll-secret-0123456789', adminPassword: 'admin-password-42', configKey: pub }));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const admin = { authorization: `Basic ${Buffer.from('admin:admin-password-42').toString('base64')}`, 'content-type': 'application/json' };
  const put = (body: string) => fetch(`${base}/api/config`, { method: 'PUT', headers: admin, body });
  try {
    assert.equal((await put(signed('global', 2))).status, 200);
    assert.equal((await put(signed('global', 1))).status, 409, 'older version');
    const forged = JSON.parse(signed('global', 3)) as Bundle;
    assert.equal((await put(JSON.stringify({ ...forged, payload: forged.payload.replace('false', 'true') }))).status, 400);
    assert.equal((await fetch(`${base}/api/config`, { method: 'PUT', body: signed('global', 9), headers: { 'content-type': 'application/json' } })).status, 401);

    const e = await (await fetch(`${base}/api/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'enroll-secret-0123456789', deviceKey: 'b'.repeat(64), group: 'ИБ' }) })).json() as { token: string; deviceId: string };
    const bearer = { authorization: `Bearer ${e.token}`, 'content-type': 'application/json' };
    const beat = await (await fetch(`${base}/api/beat`, { method: 'POST', headers: bearer, body: JSON.stringify({ mood: 'awake', config: { global: 1 } }) })).json() as { config: Record<string, number> };
    assert.deepEqual(beat.config, { global: 2 });
    const got = await (await fetch(`${base}/api/config`, { headers: bearer })).json() as { bundles: Bundle[] };
    const r = accept(got.bundles, publicKey(pub), scopesFor('ИБ', e.deviceId), {});
    assert.deepEqual(r.payloads.map((p) => p.version), [2]);
    const list = await (await fetch(`${base}/api/devices`, { headers: admin })).json() as { devices: { config: Record<string, number> }[] };
    assert.deepEqual(list.devices[0]!.config, { global: 1 }, 'the card shows what the device applied');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
