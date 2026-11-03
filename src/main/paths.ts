// Пути к папкам проекта. Собранный главный процесс лежит в build/, ресурсы в корне.
import path from 'node:path';

export const ROOT = path.join(__dirname, '..');
export const BUILD = path.join(ROOT, 'build');
export const ASSETS = path.join(ROOT, 'assets');
export const VOSK_MODEL = path.join(ASSETS, 'vosk', 'model-ru.tar.gz');
