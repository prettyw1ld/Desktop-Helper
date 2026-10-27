// Фоновые наблюдатели: календарь и окна других программ.
const { screen } = require('electron');
const calendar = require('../calendar');
const windowsWatch = require('../windows');
const I18N = require('../renderer/i18n');
const settings = require('./settings');
const ui = require('./ui');

const t = (k, v) => I18N.t(k, v);

// ---------- Календарь ----------
function startCalendar() {
  const s = settings.get();
  calendar.start({
    url: s.calendarUrl,
    before: Number(s.calendarBefore) || 10,
    onSoon: (e, min) => {
      const text = min > 0 ? t('cal.soon', { min, title: e.title }) : t('cal.now', { title: e.title });
      ui.notify(t('notif.calendar'), text);
      ui.showInactive();
      ui.send('calendar-soon', { ...e, min, text });
    },
  }).then(() => ui.send('calendar-changed'));
}

function calendarList(days) {
  return { ...calendar.status(), events: calendar.upcoming(days) };
}

// ---------- Окна других программ ----------
function startWindowsWatch() {
  windowsWatch.stop();
  ui.send('windows', []);
  if (!settings.get().windows) return;
  const toDip = (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r);
  windowsWatch.start((list) => {
    // переводим в координаты нашего окна (оно занимает рабочую область основного экрана)
    const wa = screen.getPrimaryDisplay().workArea;
    ui.send('windows', list.map(([id, x, y, w, h]) => [id, x - wa.x, y - wa.y, w, h]));
  }, toDip);
}

function stopAll() {
  windowsWatch.stop();
}

module.exports = { startCalendar, calendarList, refreshCalendar: () => calendar.refresh(), startWindowsWatch, stopAll };
