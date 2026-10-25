// Запросы к ИИ идут через сеть Chromium (electron.net.fetch): она берёт системный прокси и VPN,
// как браузер. Обычный fetch из Node их не видит и падает с «fetch failed».
// Если один способ не достучался, пробуем второй.
let netFetch = null;
try { netFetch = require('electron').net?.fetch?.bind(require('electron').net) || null; } catch { /* не Electron */ }

const isNetErr = (e) => e && e.name !== 'AbortError' && e.name !== 'TimeoutError' && /fetch failed|net::|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(`${e.message} ${e.cause?.code || ''}`);

async function fetchAI(url, opts = {}) {
  // связь иногда рвётся на секунду: третья попытка после короткой паузы
  const ways = netFetch ? [netFetch, globalThis.fetch, netFetch] : [globalThis.fetch, globalThis.fetch];
  let last;
  for (const [i, f] of ways.entries()) {
    if (i === ways.length - 1) await new Promise((r) => setTimeout(r, 900));
    try {
      return await f(url, opts);
    } catch (e) {
      last = e;
      if (!isNetErr(e)) throw e;
    }
  }
  throw Object.assign(new Error(last?.message || 'network'), { network: true, cause: last });
}

module.exports = { fetchAI, isNetErr };
