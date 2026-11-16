// Скачивает маленькую русскую модель Vosk для голосового ввода без интернета (около 40 МБ).
// Запускается сам после npm install. Если не получилось, приложение работает и без голоса.
// Модель попадает в установщик, поэтому скачанный файл сверяется с известным хешом: подменённый архив
// (зеркало взломали, кто-то в сети подсунул другой файл) не сохраняется.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_URL = 'https://raw.githubusercontent.com/ccoreilly/vosk-browser/gh-pages/models/vosk-model-small-ru-0.4.tar.gz';
const DEFAULT_SHA256 = 'b855cf79a513023af4090739caa407203754d7db98ccb3b8d4162f5d7f6a3f8e';
// своё зеркало (например, внутри компании): адрес и хеш задаются вместе
const URL = process.env.PUSHIK_VOSK_URL || DEFAULT_URL;
const SHA256 = (process.env.PUSHIK_VOSK_URL ? process.env.PUSHIK_VOSK_SHA256 || '' : DEFAULT_SHA256).toLowerCase();
const OUT = path.join(import.meta.dirname, '..', 'assets', 'vosk', 'model-ru.tar.gz');

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

function ready(): boolean {
  if (!fs.existsSync(OUT) || fs.statSync(OUT).size < 1_000_000) return false;
  if (sha256(fs.readFileSync(OUT)) === SHA256) return true;
  console.warn('[pushik] Vosk model on disk does not match the expected sha256, downloading again');
  return false;
}

if (!SHA256) {
  console.warn('[pushik] PUSHIK_VOSK_URL is set without PUSHIK_VOSK_SHA256: not downloading an unchecked model. Voice input will be off.');
} else if (ready()) {
  console.log('[pushik] Vosk model is already here');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  console.log(`[pushik] downloading Vosk model: ${URL}`);
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== SHA256) throw new Error(`sha256 mismatch: got ${got}, expected ${SHA256}`);
    fs.writeFileSync(`${OUT}.part`, buf);
    fs.renameSync(`${OUT}.part`, OUT);
    console.log(`[pushik] Vosk model saved (${Math.round(buf.length / 1e6)} MB)`);
  } catch (e) {
    console.warn(`[pushik] could not download the Vosk model (${(e as Error).message}). Voice input will be off; run "npm run vosk" later.`);
  }
}
