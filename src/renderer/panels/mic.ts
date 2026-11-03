// Голосовой ввод: офлайн Vosk (по умолчанию) или Whisper по ключу, если его выбрали в настройках.
// Без микрофона кнопка просто прячется.
import { isError } from '../../shared/types';
import { grammar } from '../guide/scenarios';
import { api } from '../core/api';
import { $ } from '../core/dom';
import { T } from '../core/i18n';
import { settings } from '../core/settings';
import { listen, type Listening } from '../core/voice';
import { setIconLabel } from '../ui/icons';
import { onPanelsClose } from '../ui/panels';

const btn = () => $('#mic');
const askInput = () => $<HTMLInputElement>('#ask-input');

let onText: (text: string) => void = () => {};
let recorder: MediaRecorder | null = null;
let recTimer: ReturnType<typeof setTimeout> | undefined;
let vosk: Listening | null = null;

const useWhisper = (): boolean => settings.voice === 'whisper' && settings.hasStt;

/** Сообщение под кнопкой («Слушаю…», «Не расслышал»). Пустое — спрятать. */
export function micState(text: string): void {
  const e = $('#mic-state');
  e.textContent = text || '';
  e.classList.toggle('hidden', !text);
}

// Большая кнопка «Сказать задачу» / «Остановить запись»
function micButton(recording: boolean): void {
  const b = btn();
  setIconLabel(b, recording ? 'close' : 'mic', T(recording ? 'help.micStop' : 'help.mic'));
  b.setAttribute('aria-pressed', String(recording));
  b.classList.toggle('rec', recording);
}

const micError = (err: unknown, fallback: string): string => {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotFoundError' ? 'mic.none' : name === 'NotAllowedError' ? 'mic.denied' : fallback;
};

/** Показать кнопку, если есть микрофон и чем распознавать. */
export async function refreshMic(): Promise<void> {
  let hasMic = false;
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices();
    hasMic = !!devices?.some((d) => d.kind === 'audioinput');
  } catch { hasMic = false; }
  btn().classList.toggle('hidden', !(hasMic && (useWhisper() || settings.hasVosk)));
  if (!vosk && !recorder) micButton(false);
}

function finish(text: string): void {
  if (!text) { micState(T('mic.empty')); return; }
  micState('');
  askInput().value = text;
  onText(text);
}

async function listenOffline(): Promise<void> {
  if (vosk) { vosk.stop(); return; }
  try {
    micState(T('mic.loading'));
    vosk = await listen({
      grammar: grammar(settings.contact || ''),
      onPartial: (p) => { askInput().value = p.replace(/\[unk\]/g, '').trim(); },
    });
  } catch (err) {
    vosk = null;
    micState(T(micError(err, 'mic.noModel')));
    if (/NotFound|NotAllowed/.test((err as Error | null)?.name ?? '')) btn().classList.add('hidden');
    return;
  }
  micButton(true);
  micState(T('mic.rec'));
  const text = (await vosk.result).replace(/\[unk\]/g, '').replace(/\s+/g, ' ').trim();
  vosk = null;
  micButton(false);
  finish(text);
}

async function recordWhisper(): Promise<void> {
  if (recorder) { if (recorder.state === 'recording') recorder.stop(); return; }
  await api.askMic();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    micState(T(micError(err, 'mic.denied')));
    btn().classList.add('hidden');
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder = rec;
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    clearTimeout(recTimer);
    stream.getTracks().forEach((tr) => tr.stop());
    micButton(false);
    const type = rec.mimeType || 'audio/webm';
    recorder = null;
    const blob = new Blob(chunks, { type });
    if (blob.size < 1500) { micState(T('mic.empty')); return; }
    micState(T('mic.wait'));
    const res = await api.transcribe(await blob.arrayBuffer(), type);
    if (isError(res)) { micState(res.error); return; }
    finish(res.text);
  };
  rec.start();
  micButton(true);
  micState(T('mic.rec'));
  recTimer = setTimeout(() => recorder?.stop(), 15_000);
}

/** onVoiceText: что делать с распознанной фразой. */
export function initMic(onVoiceText: (text: string) => void): void {
  onText = onVoiceText;
  btn().addEventListener('click', async () => {
    if (!useWhisper()) { await api.askMic(); void listenOffline(); return; }
    void recordWhisper();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { void refreshMic(); });
  onPanelsClose(() => { if (recorder) recorder.stop(); });
  micButton(false);
}
