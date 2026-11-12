// Присутствие: кот сообщает серверу организации, бодрствует он, дремлет или спит.
// Здесь только логика без Electron (её проверяют тесты); сеть и события системы — в presence-agent.ts.
// Отправляется только состояние, версия и простой: ни снимков, ни текста, ни названий окон.

export type Mood = 'awake' | 'dozing' | 'asleep';
export type SleepReason = '' | 'lock' | 'suspend' | 'quit' | 'logoff' | 'shutdown';

/** Сколько секунд без мыши и клавиатуры — и кот «дремлет». */
export const DOZE_AFTER = 300;
/** Как часто сообщать, что жив. Сервер считает кота потерявшимся после трёх пропусков. */
export const BEAT_MS = 45_000;

export interface Flags { locked: boolean; suspended: boolean }

export function moodOf(f: Flags, idleSec: number): { mood: Mood; reason: SleepReason } {
  if (f.suspended) return { mood: 'asleep', reason: 'suspend' };
  if (f.locked) return { mood: 'asleep', reason: 'lock' };
  return { mood: idleSec >= DOZE_AFTER ? 'dozing' : 'awake', reason: '' };
}

/** Пауза перед новой попыткой: 2 с, 4 с, 8 с… до 5 минут, ±20%, чтобы сотни котов не стучались разом. */
export function backoff(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(300_000, 2000 * 2 ** Math.max(0, Math.min(attempt, 20)));
  return Math.round(base * (0.8 + 0.4 * rand()));
}

export interface Beat {
  kind: 'beat' | 'event' | 'bye';
  mood: Mood;
  reason: SleepReason;
  idleSec: number;
  version: string;
}

export function beat(kind: Beat['kind'], f: Flags, idleSec: number, version: string, reason?: SleepReason): Beat {
  const m = kind === 'bye' ? { mood: 'asleep' as const, reason: reason || 'quit' } : moodOf(f, idleSec);
  return { kind, ...m, idleSec: Math.max(0, Math.round(idleSec)), version };
}

/** Что знает о себе устройство при регистрации. */
export interface Enroll {
  secret: string;
  deviceKey: string;   // машина + пользователь: у двух людей на одном ПК — два кота
  host: string;
  user: string;
  os: string;
  version: string;
}

/** Ключ устройства: хеш, чтобы не отдавать серверу GUID машины и SID как есть. */
export function deviceKey(machineId: string, userSid: string, hash: (s: string) => string): string {
  return hash(`pushik:${machineId.trim().toLowerCase()}:${userSid.trim().toUpperCase()}`);
}

/** GUID машины из `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid`. */
export function parseMachineGuid(out: string): string {
  return /MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i.exec(out)?.[1] ?? '';
}

/** SID из `whoami /user /fo csv /nh`: "domain\\user","S-1-5-21-…". */
export function parseSid(out: string): string {
  return /"(S-1-[\d-]+)"/.exec(out)?.[1] ?? '';
}
