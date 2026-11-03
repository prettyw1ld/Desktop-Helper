// pushik://vosk/model-ru.tar.gz: так распознаватель речи (он работает в Web Worker) может скачать модель из приложения
import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ASSETS } from './paths';

// Вызывать до app.whenReady()
export function register(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'pushik', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

// Вызывать после app.whenReady()
export function serve(): void {
  protocol.handle('pushik', (req) => {
    const u = new URL(req.url);
    const file = path.normalize(path.join(ASSETS, u.hostname, decodeURIComponent(u.pathname)));
    if (!file.startsWith(ASSETS) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    const headers = { 'access-control-allow-origin': '*', 'content-length': String(fs.statSync(file).size) };
    const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { headers });
  });
}
