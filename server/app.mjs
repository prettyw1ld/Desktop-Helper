// HTTP-обработчик сервера присутствия. Без фреймворков: маршрутов мало, зависимостей меньше.
//   POST /api/enroll   секрет регистрации → токен устройства
//   POST /api/beat     «жив» и смены состояния (Bearer-токен устройства)
//   GET  /api/devices  список для админ-панели (пароль администратора)
//   DELETE /api/devices/<id>  забыть устройство: его токен перестанет работать
//   GET  /             сама админ-панель
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOODS, REASONS, statusOf } from './status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(HERE, 'public', 'index.html'));
const SCRIPT = fs.readFileSync(path.join(HERE, 'public', 'app.js'));
const MAX_BODY = 16 * 1024;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(sha(String(a)));
  const y = Buffer.from(sha(String(b)));
  return crypto.timingSafeEqual(x, y);
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) { reject(new HttpError(415, 'json only')); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(new HttpError(400, 'bad json')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(json ? JSON.stringify(body) : body);
}

/** Не больше n попыток регистрации в минуту с одного адреса. */
function limiter(n) {
  const hits = new Map();
  return (key, now) => {
    const list = (hits.get(key) || []).filter((t) => now - t < 60_000);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10_000) hits.clear();
    return list.length <= n;
  };
}

export function createApp({ store, enrollSecret, adminPassword, now = () => Date.now() }) {
  if (!enrollSecret || enrollSecret.length < 16) throw new Error('ENROLL_SECRET must be at least 16 characters');
  if (!adminPassword || adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  const enrollOk = limiter(20);

  function admin(req) {
    const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
    const [user, ...rest] = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':') : [];
    if (user === 'admin' && same(rest.join(':'), adminPassword)) return;
    throw new HttpError(401, 'admin');
  }

  async function device(req) {
    const m = /^Bearer\s+([\w-]{20,200})$/.exec(req.headers.authorization || '');
    const d = m ? await store.byToken(sha(m[1])) : null;
    if (!d) throw new HttpError(401, 'token');
    return d;
  }

  async function enroll(req) {
    const ip = req.socket.remoteAddress || '';
    if (!enrollOk(ip, now())) throw new HttpError(429, 'slow down');
    const b = await readJson(req);
    if (!same(b.secret, enrollSecret)) throw new HttpError(403, 'secret');
    const deviceKey = str(b.deviceKey, 128);
    if (!/^[0-9a-f]{64}$/.test(deviceKey)) throw new HttpError(400, 'deviceKey');
    const token = crypto.randomBytes(32).toString('base64url');
    const d = await store.enroll({
      deviceKey, host: str(b.host, 64), user: str(b.user, 128), os: str(b.os, 64), version: str(b.version, 32),
      tokenHash: sha(token), now: now(),
    });
    return { token, deviceId: d.id };
  }

  async function beat(req) {
    const d = await device(req);
    const b = await readJson(req);
    const mood = MOODS.has(b.mood) ? b.mood : 'awake';
    const reason = mood === 'asleep' && REASONS.has(b.reason) ? b.reason : '';
    const idleSec = Number.isFinite(b.idleSec) ? Math.max(0, Math.min(10 ** 7, Math.round(b.idleSec))) : 0;
    await store.beat(d.id, { mood, reason, idleSec, version: str(b.version, 32) || d.version, now: now() });
    return { ok: true };
  }

  async function devices() {
    const t = now();
    const list = (await store.list()).map((d) => ({
      id: d.id, host: d.host, user: d.user, os: d.os, version: d.version,
      status: statusOf(d, t), mood: d.mood, reason: d.reason, idleSec: d.idleSec, lastSeen: d.lastSeen, createdAt: d.createdAt,
    }));
    const counts = { awake: 0, dozing: 0, asleep: 0, lost: 0, offline: 0 };
    for (const d of list) counts[d.status]++;
    return { now: t, counts, devices: list };
  }

  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'POST' && p === '/api/enroll') return send(res, 200, await enroll(req));
      if (req.method === 'POST' && p === '/api/beat') return send(res, 200, await beat(req));
      if (req.method === 'GET' && p === '/api/devices') { admin(req); return send(res, 200, await devices()); }
      const del = /^\/api\/devices\/([0-9a-f-]{36})$/.exec(p);
      if (req.method === 'DELETE' && del) { admin(req); return send(res, (await store.remove(del[1])) ? 200 : 404, { ok: true }); }
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        admin(req);
        return send(res, 200, PAGE, {
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          'x-frame-options': 'DENY',
        });
      }
      if (req.method === 'GET' && p === '/app.js') { admin(req); return send(res, 200, SCRIPT, { 'content-type': 'text/javascript; charset=utf-8' }); }
      if (req.method === 'GET' && p === '/healthz') return send(res, 200, { ok: true });
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (e instanceof HttpError) {
        return send(res, e.status, { error: e.code }, e.status === 401 && e.code === 'admin' ? { 'www-authenticate': 'Basic realm="Pushik", charset="UTF-8"' } : {});
      }
      console.error(e);
      return send(res, 500, { error: 'server' });
    }
  };
}
