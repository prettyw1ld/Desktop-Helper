// Запуск сервера присутствия.
//   ENROLL_SECRET   секрет регистрации, тот же, что presence.secret в политике (от 16 знаков)
//   ADMIN_PASSWORD  пароль входа в админ-панель, пользователь admin (от 12 знаков)
//   DATABASE_URL    postgres://… ; без него всё хранится в памяти до перезапуска
//   PORT            8443 по умолчанию
//   TLS_CERT, TLS_KEY  пути к сертификату и ключу; без них — обычный http за nginx
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createApp } from './app.mjs';
import { memoryStore } from './store-memory.mjs';

const env = process.env;
const store = env.DATABASE_URL ? await (await import('./store-pg.mjs')).pgStore(env.DATABASE_URL) : memoryStore();
if (!env.DATABASE_URL) console.warn('DATABASE_URL не задан: устройства хранятся в памяти до перезапуска');
const handle = createApp({ store, enrollSecret: env.ENROLL_SECRET || '', adminPassword: env.ADMIN_PASSWORD || '' });
const tls = env.TLS_CERT && env.TLS_KEY ? { cert: fs.readFileSync(env.TLS_CERT), key: fs.readFileSync(env.TLS_KEY) } : null;
const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
const port = Number(env.PORT) || 8443;
server.listen(port, () => console.log(`pushik-server: ${tls ? 'https' : 'http'} :${port}`));
const stop = () => server.close(() => { void store.close().finally(() => process.exit(0)); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
