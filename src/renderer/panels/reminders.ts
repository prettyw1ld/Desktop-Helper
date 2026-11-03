// Напоминания, фокус-таймер над котом и ближайшие встречи из календаря.
import type { Reminder } from '../../shared/types';
import { onFrame } from '../cat/behaviour';
import { cat, setState } from '../cat/cat';
import { happy, showPose, surprised } from '../cat/poses';
import { api } from '../core/api';
import { $, $$, dom, el } from '../core/dom';
import { locale, T } from '../core/i18n';
import { Sound } from '../core/sound';
import { busyWithPerson } from '../guide/state';
import { say } from '../ui/bubble';
import { openPanel, registerPanel } from '../ui/panels';

let reminders: Reminder[] = [];
export const allReminders = (): readonly Reminder[] => reminders;

const fmtLeft = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export async function refreshReminders(): Promise<void> {
  reminders = await api.listReminders();
  if (openPanel() === 'reminders') renderReminders();
}

const emptyLi = (ul: HTMLElement, text: string) => ul.append(el('li', 'empty', text));

function renderReminders(): void {
  const ul = $('#rem-list');
  ul.replaceChildren();
  if (!reminders.length) { emptyLi(ul, T('rem.empty')); return; }
  for (const r of [...reminders].sort((a, b) => a.at - b.at)) {
    const t = el('span', 't', fmtLeft(r.at - Date.now()));
    t.dataset.at = String(r.at);
    const x = el('button', 'icon x', '✕');
    x.title = T('rem.cancel');
    x.onclick = async () => { await api.cancelReminder(r.id); void refreshReminders(); };
    const li = el('li');
    li.append(t, el('span', '', (r.kind === 'focus' ? '🎯 ' : '') + r.text), x);
    ul.append(li);
  }
}

// Таймер фокуса над котом
function updateBadge(): void {
  const f = reminders.filter((r) => r.kind === 'focus').sort((a, b) => a.at - b.at)[0];
  dom.badge.classList.toggle('hidden', !f);
  if (f) dom.badge.textContent = `🎯 ${fmtLeft(f.at - Date.now())}`;
}

async function renderCalendar(): Promise<void> {
  const ul = $('#cal-list');
  const res = await api.listCalendar(2);
  ul.replaceChildren();
  if (!res.connected) { emptyLi(ul, T('cal.off')); return; }
  if (res.error) { emptyLi(ul, T('cal.error', { err: res.error })); return; }
  if (!res.events.length) { emptyLi(ul, T('cal.none')); return; }
  const today = new Date().toDateString();
  let lastDay = '';
  for (const e of res.events) {
    const d = new Date(e.start);
    const day = d.toDateString() === today || e.start < Date.now() ? T('cal.today') : T('cal.tomorrow');
    if (day !== lastDay) { ul.append(el('li', 'day', day)); lastDay = day; }
    const li = el('li', !e.allDay && e.start <= Date.now() && e.end > Date.now() ? 'now' : '');
    const time = e.allDay ? T('cal.allDay') : d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    li.append(el('span', 't', time), el('span', '', e.title));
    ul.append(li);
  }
}

// кот спит или его несут: будим и ставим на место, чтобы показать напоминание
const wake = () => { if (cat.state === 'sleep' || cat.state === 'drag') setState('idle', 8000); };

export async function initReminders(): Promise<void> {
  registerPanel('reminders', {
    show: () => { renderReminders(); void renderCalendar(); setTimeout(() => $('#rem-text').focus(), 50); },
  });
  onFrame(updateBadge);
  setInterval(() => {
    for (const t of $$('#rem-list .t')) t.textContent = fmtLeft(Number(t.dataset.at) - Date.now());
  }, 1000);

  $('#rem-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $<HTMLInputElement>('#rem-text').value.trim();
    const min = Number($<HTMLInputElement>('#rem-min').value);
    if (!text || !(min > 0)) return;
    await api.addReminder(min, text, 'reminder');
    $<HTMLInputElement>('#rem-text').value = '';
    await refreshReminders();
    happy();
    say(T('rem.saved', { min }), 2500);
  });
  for (const b of $$('.chips button')) {
    b.addEventListener('click', () => { $<HTMLInputElement>('#rem-min').value = b.dataset.min ?? ''; });
  }

  api.on('reminder', (r) => {
    void refreshReminders();
    Sound.bell();
    if (busyWithPerson()) return;
    wake();
    happy(1000);
    if (r.kind === 'focus') showPose('coffee', 8000, `${r.text} ☕`);
    else { surprised(() => showPose('wave', 5000)); say(`⏰ ${r.text}`, 15_000); }
  });
  api.on('reminders-changed', (list) => {
    reminders = list;
    if (openPanel() === 'reminders') renderReminders();
  });
  api.on('calendar-soon', (e) => {
    Sound.bell();
    if (busyWithPerson()) return;
    wake();
    surprised(() => showPose('wave', 5000));
    say(e.text, 20_000);
    if (openPanel() === 'reminders') void renderCalendar();
  });
  api.on('calendar-changed', () => { if (openPanel() === 'reminders') void renderCalendar(); });

  reminders = await api.listReminders();
}
