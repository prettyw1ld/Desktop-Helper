// Напоминания: хранятся в reminders.json и переживают перезапуск.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const I18N = require('../renderer/i18n');
const ui = require('./ui');

const t = (k, v) => I18N.t(k, v);
const remindersFile = () => path.join(app.getPath('userData'), 'reminders.json');
let reminders = [];
const timers = new Map();

function persist() {
  fs.writeFileSync(remindersFile(), JSON.stringify(reminders, null, 2));
  ui.send('reminders-changed', reminders);
}

function schedule(r) {
  const delay = Math.max(0, r.at - Date.now());
  // setTimeout не любит задержки больше ~24 дней
  if (delay > 2 ** 31 - 1) return;
  timers.set(r.id, setTimeout(() => fire(r.id), delay));
}

function add({ minutes, text, kind = 'reminder' }) {
  const r = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now() + Math.round(Number(minutes) * 60_000),
    text: String(text || t('rem.default')),
    kind,
  };
  reminders.push(r);
  schedule(r);
  persist();
  return r;
}

function cancel(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const before = reminders.length;
  reminders = reminders.filter((r) => r.id !== id);
  persist();
  return reminders.length < before;
}

function fire(id) {
  const r = reminders.find((x) => x.id === id);
  if (!r) return;
  cancel(id);
  ui.notify(r.kind === 'focus' ? t('notif.focus') : t('notif.reminder'), r.text);
  ui.showInactive();
  ui.send('reminder', r);
}

// Пропущенные, пока приложение было закрыто, покажем сразу после старта.
function load() {
  try { reminders = JSON.parse(fs.readFileSync(remindersFile(), 'utf8')); } catch { reminders = []; }
  reminders.forEach(schedule);
}

const list = () => reminders;

module.exports = { add, cancel, list, load };
