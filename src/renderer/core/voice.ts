/* Распознавание речи прямо в приложении, без интернета и ключей: Vosk (WebAssembly) с маленькой русской моделью.
   Модель (около 40 МБ) скачивается один раз при npm install в assets/vosk/ и попадает в установщик.
   Сам vosk.js подключаем тегом <script> по требованию: он большой и запускает свой Web Worker. */
import type { Model } from 'vosk-browser';
import type { RecognizerMessage } from 'vosk-browser/dist/interfaces';

declare global {
  interface Window { Vosk?: { createModel(url: string): Promise<Model> } }
}

const LIB = '../../node_modules/vosk-browser/dist/vosk.js';
const MODEL = 'pushik://vosk/model-ru.tar.gz';
let modelPromise: Promise<Model> | null = null;

function loadLib(): Promise<NonNullable<Window['Vosk']>> {
  if (window.Vosk) return Promise.resolve(window.Vosk);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = () => (window.Vosk ? resolve(window.Vosk) : reject(new Error('vosk.js did not load')));
    s.onerror = () => reject(new Error('vosk.js not found'));
    document.head.appendChild(s);
  });
}

// Модель грузится один раз и потом лежит в IndexedDB: следующий запуск быстрее.
function model(): Promise<Model> {
  modelPromise ??= loadLib().then((V) => V.createModel(MODEL)).catch((e: unknown) => { modelPromise = null; throw e; });
  return modelPromise;
}

export interface Listening { stop(): void; result: Promise<string> }

/**
 * Слушает микрофон, пока человек не замолчит на 1.8 с после фразы, не нажмёт «стоп» или не пройдёт maxMs.
 * grammar: список слов, которые ждём. Так маленькая модель почти не ошибается в командах.
 */
export async function listen({ onPartial, maxMs = 12000, grammar }: { onPartial?: (text: string) => void; maxMs?: number; grammar?: string[] } = {}): Promise<Listening> {
  const m = await model();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const ctx = new AudioContext();
  const rec = grammar ? new m.KaldiRecognizer(ctx.sampleRate, JSON.stringify(grammar)) : new m.KaldiRecognizer(ctx.sampleRate);
  const parts: string[] = [];
  let partial = '';
  let lastVoice = 0;
  let stopped = false;
  let finish: (text: string) => void = () => {};
  const result = new Promise<string>((r) => { finish = r; });

  rec.on('result', (msg: RecognizerMessage) => {
    const text = 'result' in msg && 'text' in msg.result ? msg.result.text.trim() : '';
    if (text) { parts.push(text); lastVoice = performance.now(); }
    if (stopped) done();
  });
  rec.on('partialresult', (msg: RecognizerMessage) => {
    const p = 'result' in msg && 'partial' in msg.result ? msg.result.partial.trim() : '';
    if (p && p !== partial) { partial = p; lastVoice = performance.now(); onPartial?.([...parts, p].join(' ')); }
  });

  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => { try { rec.acceptWaveform(e.inputBuffer); } catch { /* пропускаем кусок */ } };
  src.connect(node);
  node.connect(ctx.destination);

  const t0 = performance.now();
  const timer = setInterval(() => {
    const t = performance.now();
    if ((lastVoice && t - lastVoice > 1800) || t - t0 > maxMs) stop();
  }, 200);

  let doneOnce = false;
  function done(): void {
    if (doneOnce) return;
    doneOnce = true;
    clearInterval(timer);
    try { node.disconnect(); src.disconnect(); } catch { /* уже */ }
    stream.getTracks().forEach((tr) => tr.stop());
    void ctx.close();
    try { rec.remove(); } catch { /* уже */ }
    finish(parts.join(' ').trim() || partial);
  }
  function stop(): void {
    if (stopped) return;
    stopped = true;
    try { rec.retrieveFinalResult(); } catch { done(); }
    setTimeout(done, 1200); // если финальный результат не пришёл
  }
  return { stop, result };
}
