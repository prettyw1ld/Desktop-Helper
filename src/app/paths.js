// Пути к папкам проекта. Главный процесс живёт в src/, ресурсы лежат в корне.
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(ROOT, 'assets');
const VOSK_MODEL = path.join(ASSETS, 'vosk', 'model-ru.tar.gz');

module.exports = { ROOT, SRC, ASSETS, VOSK_MODEL };
