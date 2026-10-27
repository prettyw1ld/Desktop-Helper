// pushik://vosk/model-ru.tar.gz: так распознаватель речи (он работает в Web Worker) может скачать модель из приложения
const { protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { ASSETS } = require('./paths');

// Вызывать до app.whenReady()
function register() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'pushik', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

// Вызывать после app.whenReady()
function serve() {
  protocol.handle('pushik', (req) => {
    const u = new URL(req.url);
    const file = path.normalize(path.join(ASSETS, u.hostname, decodeURIComponent(u.pathname)));
    if (!file.startsWith(ASSETS) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    const headers = { 'access-control-allow-origin': '*', 'content-length': String(fs.statSync(file).size) };
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers });
  });
}

module.exports = { register, serve };
