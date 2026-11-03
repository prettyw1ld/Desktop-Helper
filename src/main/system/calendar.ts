// Google Календарь через секретный iCal-адрес: только чтение, без входа в аккаунт.
// Раз в 10 минут скачиваем календарь, за N минут до встречи зовём кота.
import ical from 'node-ical';
import type { CalendarEvent } from '../../shared/types';

const REFRESH_MS = 10 * 60_000;
const DAY = 24 * 60 * 60_000;

let url = '';
let events: CalendarEvent[] = []; // ближайшие 8 дней
let lastError = '';
let refreshTimer: NodeJS.Timeout | undefined;
let checkTimer: NodeJS.Timeout | undefined;
const warned = new Set<string>();

const normalizeUrl = (u: string): string => String(u || '').trim().replace(/^webcal:\/\//i, 'https://');

// у iCal текст бывает строкой или объектом с параметрами
const text = (v: unknown): string => (typeof v === 'object' && v ? String((v as { val?: unknown }).val ?? '') : String(v ?? ''));

export async function refresh(): Promise<void> {
  if (!url) { events = []; lastError = ''; return; }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = ical.sync.parseICS(await res.text());
    const from = new Date(Date.now() - DAY);
    const to = new Date(Date.now() + 8 * DAY);
    const list: CalendarEvent[] = [];
    for (const e of Object.values(data)) {
      if (!e || e.type !== 'VEVENT' || e.status === 'CANCELLED') continue;
      for (const i of ical.expandRecurringEvent(e, { from, to, expandOngoing: true })) {
        const start = new Date(i.start);
        const end = new Date(i.end || i.start);
        list.push({
          id: `${e.uid}@${start.getTime()}`,
          title: text(i.summary) || '—',
          start: start.getTime(),
          end: end.getTime(),
          allDay: !!i.isFullDay,
          location: text(e.location),
        });
      }
    }
    events = list.sort((a, b) => a.start - b.start);
    lastError = '';
  } catch (err) {
    lastError = (err as Error).message;
  }
}

// События, которые идут или начнутся до конца `days`-го дня (1 = только сегодня).
export function upcoming(days = 1): CalendarEvent[] {
  const now = Date.now();
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const until = end.getTime() + Math.max(1, days) * DAY;
  return events.filter((e) => e.end > now && e.start < until);
}

/**
 * Включить или перенастроить календарь.
 * onSoon(event, minutesLeft) вызывается один раз для каждой встречи за `before` минут.
 */
export function start({ url: u, before = 10, onSoon }: { url: string; before?: number; onSoon: (e: CalendarEvent, min: number) => void }): Promise<void> {
  url = normalizeUrl(u);
  clearInterval(refreshTimer);
  clearInterval(checkTimer);
  if (!url) { events = []; lastError = ''; return Promise.resolve(); }
  refreshTimer = setInterval(refresh, REFRESH_MS);
  checkTimer = setInterval(() => {
    const now = Date.now();
    for (const e of events) {
      if (e.allDay || warned.has(e.id)) continue;
      const left = (e.start - now) / 60_000;
      if (left <= before && left > -1) {
        warned.add(e.id);
        onSoon(e, Math.max(0, Math.round(left)));
      }
    }
  }, 20_000);
  return refresh();
}

export const status = (): { connected: boolean; error: string } => ({ connected: !!url, error: lastError });
