// Голос → текст через любой Whisper-совместимый сервис (/audio/transcriptions).
// По умолчанию Groq: Whisper large-v3 бесплатно, нужен только бесплатный ключ с console.groq.com.
// Подойдут и OpenAI (https://api.openai.com/v1, whisper-1), и свой сервер (faster-whisper-server и т.п.).
import { fetchAI, readError } from './http';

export const DEFAULT_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_MODEL = 'whisper-large-v3';

interface SttOptions { sttUrl?: string; sttKey?: string; sttModel?: string; lang?: string }

export async function transcribe({ sttUrl, sttKey, sttModel, lang }: SttOptions, audio: Buffer, mime = 'audio/webm'): Promise<string> {
  const base = (sttUrl || DEFAULT_URL).replace(/\/+$/, '');
  const form = new FormData();
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `voice.${ext}`);
  form.append('model', sttModel || DEFAULT_MODEL);
  form.append('language', lang === 'en' ? 'en' : 'ru');
  form.append('response_format', 'json');
  const headers: Record<string, string> = sttKey ? { authorization: `Bearer ${sttKey}` } : {};
  const res = await fetchAI(`${base}/audio/transcriptions`, {
    method: 'POST', headers, body: form, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json() as { text?: string };
  return String(data.text || '').trim();
}
