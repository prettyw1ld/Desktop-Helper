// Состояние кота для админ-панели из последнего сообщения агента.
// Агент шлёт «жив» раз в 45 с; три пропуска подряд — кот потерялся, час тишины — не в сети.

export const BEAT_SEC = 45;
export const LOST_AFTER = BEAT_SEC * 3;
export const OFFLINE_AFTER = 3600;

/** awake | dozing | asleep | lost | offline */
export function statusOf(d, now = Date.now()) {
  const silent = (now - d.lastSeen) / 1000;
  if (d.mood === 'asleep') return silent > 7 * 86400 ? 'offline' : 'asleep';
  if (silent > OFFLINE_AFTER) return 'offline';
  if (silent > LOST_AFTER) return 'lost';
  return d.mood === 'dozing' ? 'dozing' : 'awake';
}

export const MOODS = new Set(['awake', 'dozing', 'asleep']);
export const REASONS = new Set(['', 'lock', 'suspend', 'quit', 'logoff', 'shutdown']);
