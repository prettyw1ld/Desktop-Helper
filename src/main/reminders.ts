// Напоминания: хранятся в reminders.json и переживают перезапуск.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { T } from '../shared/i18n';
import type { Reminder, ReminderKind } from '../shared/types';
import * as ui from './ui';

const remindersFile = () => path.join(app.getPath('userData'), 'reminders.json');
let reminders: Reminder[] = [];
const timers = new Map<string, NodeJS.Timeout>();

function persist(): void {
  fs.writeFileSync(remindersFile(), JSON.stringify(reminders, null, 2));
  ui.send('reminders-changed', reminders);
}

function schedule(r: Reminder): void {
  const delay = Math.max(0, r.at - Date.now());
  // setTimeout не любит задержки больше ~24 дней
  if (delay > 2 ** 31 - 1) return;
  timers.set(r.id, setTimeout(() => fire(r.id), delay));
}

export function add({ minutes, text, kind = 'reminder' }: { minutes: unknown; text?: unknown; kind?: ReminderKind }): Reminder {
  const r: Reminder = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now() + Math.round(Number(minutes) * 60_000),
    text: String(text || T('rem.default')),
    kind,
  };
  reminders.push(r);
  schedule(r);
  persist();
  return r;
}

export function cancel(id: string): boolean {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const before = reminders.length;
  reminders = reminders.filter((r) => r.id !== id);
  persist();
  return reminders.length < before;
}

function fire(id: string): void {
  const r = reminders.find((x) => x.id === id);
  if (!r) return;
  cancel(id);
  ui.notify(r.kind === 'focus' ? T('notif.focus') : T('notif.reminder'), r.text);
  ui.showInactive();
  ui.send('reminder', r);
}

// Пропущенные, пока приложение было закрыто, покажем сразу после старта.
export function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(remindersFile(), 'utf8')) as unknown;
    reminders = Array.isArray(raw) ? raw as Reminder[] : [];
  } catch {
    reminders = [];
  }
  reminders.forEach(schedule);
}

export const list = (): Reminder[] => reminders;
