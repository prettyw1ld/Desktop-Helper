// Фоновые наблюдатели: календарь и окна других программ.
import { screen } from 'electron';
import { T } from '../shared/i18n';
import type { CalendarList } from '../shared/types';
import * as calendar from './system/calendar';
import * as windowsWatch from './system/windows';
import * as settings from './settings';
import * as ui from './ui';

// ---------- Календарь ----------
export function startCalendar(): void {
  const s = settings.get();
  calendar.start({
    url: s.calendarUrl,
    before: Number(s.calendarBefore) || 10,
    onSoon: (e, min) => {
      const text = min > 0 ? T('cal.soon', { min, title: e.title }) : T('cal.now', { title: e.title });
      ui.notify(T('notif.calendar'), text);
      ui.showInactive();
      ui.send('calendar-soon', { ...e, min, text });
    },
  }).then(() => ui.send('calendar-changed'));
}

export function calendarList(days: number): CalendarList {
  return { ...calendar.status(), events: calendar.upcoming(days) };
}

export const refreshCalendar = (): Promise<void> => calendar.refresh();

// ---------- Окна других программ ----------
export function startWindowsWatch(): void {
  windowsWatch.stop();
  ui.send('windows', []);
  if (!settings.get().windows) return;
  const toDip = (r: Electron.Rectangle) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r);
  windowsWatch.start((list) => {
    // переводим в координаты нашего окна (оно занимает весь основной экран)
    const wa = screen.getPrimaryDisplay().bounds;
    ui.send('windows', list.map(([id, x, y, w, h]) => [id, x - wa.x, y - wa.y, w, h]));
  }, toDip);
}

export function stopAll(): void {
  windowsWatch.stop();
}
