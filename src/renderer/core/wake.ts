/* «Пушик!», как «Привет, Сири»: кот слушает микрофон и ждёт своё имя, а потом просьбу.
   Всё распознаётся здесь же, той же офлайн-моделью Vosk, что и кнопка микрофона: звук никуда не уходит.
   Слова «пушик» в маленькой модели нет, она слышит его как «пушок», «пушки», «пушкин»…
   Поэтому ждём эти слова: распознаватель с коротким списком слов почти не путает их с обычной речью. */
import type { KaldiRecognizer } from 'vosk-browser';
import type { RecognizerMessage } from 'vosk-browser/dist/interfaces';
import { model } from './voice';

/** Как модель слышит «Пушик». */
export const NAME_WORDS = ['пушок', 'пушки', 'пушкин', 'пушка', 'пушку', 'пушке'];
const NAME_RE = new RegExp(`(^|\\s)(${NAME_WORDS.join('|')})(?=\\s|$)`);

/** Есть ли в услышанном имя кота. */
export const heardName = (text: string): boolean => NAME_RE.test(text.toLowerCase());

/** Просьба без имени в начале и без «[unk]»: «пущу открой почту» → «открой почту». */
export function stripName(text: string): string {
  return text.toLowerCase().replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^((с?пу[шщ]\S*)\s*)+/, '').trim();
}

const RATE = 16000;        // модели хватает 16 кГц, так распознавателю меньше работы
const CHUNK = 2048;        // кусочек звука, около 0,13 с
const REPLAY = 3;          // столько кусочков до момента, когда узнали имя, отдаём и просьбе: «Пушик, открой…» на одном дыхании
const PAUSE_MS = 1600;     // замолчал после просьбы — значит, договорил
const WAIT_MS = 7000;      // позвали и молчат — перестаём ждать
const MAX_MS = 15000;

export interface EarHooks {
  /** Услышал имя. Вернуть false, если сейчас откликаться не надо (тогда слушаем имя дальше). */
  onName(): boolean;
  /** Что уже расслышал из просьбы. */
  onPartial(text: string): void;
  /** Просьба целиком, без имени. Пусто — ничего не сказали. */
  onPhrase(text: string): void;
  /** Микрофон пропал (выдернули, отключили в системе). */
  onLost(): void;
}

export interface Ear { stop(): void }

const textOf = (msg: RecognizerMessage, key: 'text' | 'partial'): string => {
  const r = 'result' in msg ? (msg.result as Record<string, unknown>) : {};
  return typeof r[key] === 'string' ? (r[key] as string).trim() : '';
};

/** Включить уши. Бросает ошибку, если нет модели или микрофона (NotFoundError, NotAllowedError). */
export async function startEar(h: EarHooks): Promise<Ear> {
  const m = await model();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const ctx = new AudioContext({ sampleRate: RATE });
  const rate = ctx.sampleRate;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(CHUNK, 1, 1);
  const recent: Float32Array[] = [];
  let stopped = false;
  let rec: KaldiRecognizer;
  let phrase: { parts: string[]; partial: string; t0: number; lastVoice: number; ending: boolean } | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const drop = (r: KaldiRecognizer): void => { try { r.remove(); } catch { /* уже */ } };

  function listenForName(): void {
    phrase = null;
    const r = new m.KaldiRecognizer(rate, JSON.stringify([...NAME_WORDS, '[unk]']));
    const check = (text: string): void => {
      if (stopped || rec !== r || !heardName(text)) return;
      if (h.onName()) startPhrase(); else { drop(r); listenForName(); } // занят: начинаем слушать имя заново
    };
    r.on('partialresult', (msg) => check(textOf(msg, 'partial')));
    r.on('result', (msg) => check(textOf(msg, 'text')));
    rec = r;
  }

  function startPhrase(): void {
    drop(rec);
    const r = new m.KaldiRecognizer(rate);
    const p = { parts: [] as string[], partial: '', t0: performance.now(), lastVoice: 0, ending: false };
    const said = (): string => stripName([...p.parts, p.partial].join(' '));
    r.on('result', (msg) => {
      if (rec !== r) return;
      const t = textOf(msg, 'text');
      if (t) { p.parts.push(t); p.partial = ''; if (said()) p.lastVoice = performance.now(); }
      if (p.ending) endPhrase(r);
    });
    r.on('partialresult', (msg) => {
      if (rec !== r) return;
      const t = textOf(msg, 'partial');
      if (!t || t === p.partial) return;
      p.partial = t;
      // голос считаем только после имени: позвали и задумались — ждём просьбу дальше
      const text = said();
      if (text) { p.lastVoice = performance.now(); h.onPartial(text); }
    });
    rec = r;
    phrase = p;
    for (const chunk of recent) { try { r.acceptWaveformFloat(chunk, rate); } catch { /* пропускаем */ } }
    timer = setInterval(() => {
      const t = performance.now();
      const over = p.lastVoice ? t - p.lastVoice > PAUSE_MS : t - p.t0 > WAIT_MS;
      if (!p.ending && (over || t - p.t0 > MAX_MS)) {
        p.ending = true;
        try { r.retrieveFinalResult(); } catch { endPhrase(r); }
        setTimeout(() => endPhrase(r), 1200); // если финальный результат не пришёл
      }
    }, 200);
  }

  function endPhrase(r: KaldiRecognizer): void {
    if (rec !== r || !phrase) return;
    clearInterval(timer);
    const text = stripName([...phrase.parts, phrase.partial].join(' '));
    drop(r);
    listenForName();
    if (!stopped) h.onPhrase(text);
  }

  node.onaudioprocess = (e) => {
    if (stopped) return;
    const data = e.inputBuffer.getChannelData(0).slice();
    recent.push(data);
    if (recent.length > REPLAY) recent.shift();
    try { rec.acceptWaveformFloat(data, rate); } catch { /* пропускаем кусок */ }
  };
  for (const tr of stream.getAudioTracks()) tr.addEventListener('ended', () => { if (!stopped) h.onLost(); });
  listenForName();
  src.connect(node);
  node.connect(ctx.destination);

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try { node.disconnect(); src.disconnect(); } catch { /* уже */ }
      stream.getTracks().forEach((tr) => tr.stop());
      void ctx.close();
      drop(rec);
    },
  };
}
