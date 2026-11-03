// Запросы к ИИ идут через сеть Chromium (electron.net.fetch): она берёт системный прокси и VPN,
// как браузер. Обычный fetch из Node их не видит и падает с «fetch failed».
// Если один способ не достучался, пробуем второй.
import { net } from 'electron';

type Fetch = (url: string, opts?: RequestInit) => Promise<Response>;

/** Ошибка запроса к ИИ с признаками для понятного сообщения человеку. */
export interface AiError extends Error {
  network?: boolean;  // нет связи
  offline?: boolean;  // Ollama не отвечает
  code?: string;
}
export const aiError = (message: string, extra: Partial<AiError> = {}): AiError => Object.assign(new Error(message), extra);

const netFetch: Fetch | null = typeof net?.fetch === 'function' ? net.fetch.bind(net) : null;

export const isNetErr = (e: unknown): boolean => {
  if (!(e instanceof Error) || e.name === 'AbortError' || e.name === 'TimeoutError') return false;
  const cause = (e as Error & { cause?: { code?: string } }).cause;
  return /fetch failed|net::|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(`${e.message} ${cause?.code ?? ''}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchAI(url: string, opts: RequestInit = {}): Promise<Response> {
  // связь иногда рвётся на секунду: третья попытка после короткой паузы
  const ways: Fetch[] = netFetch ? [netFetch, globalThis.fetch, netFetch] : [globalThis.fetch, globalThis.fetch];
  let last: unknown;
  for (const [i, f] of ways.entries()) {
    if (i === ways.length - 1) await sleep(900);
    try {
      return await f(url, opts);
    } catch (e) {
      last = e;
      if (!isNetErr(e)) throw e;
    }
  }
  throw aiError((last as Error | undefined)?.message || 'network', { network: true, cause: last });
}

// Бесплатный Groq ограничивает число слов в минуту (снимок экрана ~2700). На 429 ждём,
// сколько просит сервис (до 25 с), и пробуем ещё раз, чтобы человек не видел ошибку.
let onWait: (sec: number) => void = () => {};
export const setOnWait = (fn: (sec: number) => void): void => { onWait = fn; };

export async function fetchAIRetry(url: string, opts: RequestInit = {}): Promise<Response> {
  let res = await fetchAI(url, opts);
  for (let i = 0; i < 2 && res.status === 429; i++) {
    let wait = Number(res.headers.get('retry-after')) || 0;
    if (!wait) {
      try { wait = Number((await res.clone().text()).match(/try again in ([\d.]+)\s*s/i)?.[1]) || 0; } catch { /* пусто */ }
    }
    wait = Math.ceil(wait || 10);
    if (wait > 25) break;
    onWait(wait);
    await sleep(wait * 1000 + 300);
    res = await fetchAI(url, opts);
  }
  return res;
}

/** Ошибка из ответа сервиса: его сообщение или код HTTP. */
export async function readError(res: Response): Promise<Error> {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json() as { error?: string | { message?: string } };
    msg = (typeof j.error === 'object' ? j.error.message : j.error) || msg;
  } catch { /* пусто */ }
  return new Error(msg);
}

export const errorDetails = (err: unknown): string => {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return `${(err as Error).message} ${cause?.code || cause?.message || ''}`;
};
