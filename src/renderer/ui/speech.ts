// Голос кота: читаем подсказки вслух средствами системы.
import { settings } from '../core/settings';

export function speak(text: string): void {
  if (!settings.speak || !('speechSynthesis' in window) || !text) return;
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}☀-➿️*«»]/gu, '').trim();
  if (!clean) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const lang = settings.lang === 'en' ? 'en' : 'ru';
  u.lang = lang === 'en' ? 'en-US' : 'ru-RU';
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  u.rate = Number(settings.voiceRate) || 0.95;
  u.pitch = 1.15;
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
