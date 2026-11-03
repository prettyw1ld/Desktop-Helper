// Скачивает маленькую русскую модель Vosk для голосового ввода без интернета (около 40 МБ).
// Запускается сам после npm install. Если не получилось, приложение работает и без голоса.
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.PUSHIK_VOSK_URL
  || 'https://raw.githubusercontent.com/ccoreilly/vosk-browser/gh-pages/models/vosk-model-small-ru-0.4.tar.gz';
const OUT = path.join(import.meta.dirname, '..', 'assets', 'vosk', 'model-ru.tar.gz');

if (fs.existsSync(OUT) && fs.statSync(OUT).size > 1_000_000) {
  console.log('[pushik] Vosk model is already here');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  console.log(`[pushik] downloading Vosk model: ${URL}`);
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(`${OUT}.part`, buf);
    fs.renameSync(`${OUT}.part`, OUT);
    console.log(`[pushik] Vosk model saved (${Math.round(buf.length / 1e6)} MB)`);
  } catch (e) {
    console.warn(`[pushik] could not download the Vosk model (${(e as Error).message}). Voice input will be off; run "npm run vosk" later.`);
  }
}
