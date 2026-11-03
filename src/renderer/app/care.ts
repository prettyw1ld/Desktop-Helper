// Забота о человеке: напоминания о перерыве, кот иногда сам что-то говорит, приветствие.
import { cat, setState } from '../cat/cat';
import { showPose } from '../cat/poses';
import { T } from '../core/i18n';
import { settings } from '../core/settings';
import { rand } from '../core/util';
import { busyWithPerson } from '../guide/state';
import { allReminders } from '../panels/reminders';
import { say } from '../ui/bubble';
import { openPanel } from '../ui/panels';

let breakTimer: ReturnType<typeof setInterval> | undefined;

export function resetBreakTimer(): void {
  clearInterval(breakTimer);
  if (!settings.breakEvery) return;
  breakTimer = setInterval(() => {
    if (allReminders().some((r) => r.kind === 'focus') || busyWithPerson()) return;
    if (cat.state === 'sleep') setState('idle', 8000);
    showPose('coffee', 9000, T('say.break', { min: settings.breakEvery }));
  }, settings.breakEvery * 60_000);
}

export function scheduleChatter(): void {
  setTimeout(() => {
    if (settings.chatter && !openPanel() && !busyWithPerson() && !['sleep', 'drag', 'jump', 'fall'].includes(cat.state)) {
      if (Date.now() - cat.lastPet > 20 * 60_000 && Math.random() < 0.4) {
        cat.wantsAttention = true;
        setState('idle', 12_000);
        say(T('say.beg'), 4000);
      } else {
        say(T('say.chatter'), 3500);
      }
    }
    scheduleChatter();
  }, rand(4, 9) * 60_000);
}

export function greeting(): string {
  const h = new Date().getHours();
  const name = settings.userName ? `, ${settings.userName}` : '';
  const key = h < 6 ? 'greet.night' : h < 12 ? 'greet.morning' : h < 18 ? 'greet.day' : 'greet.evening';
  return T(key, { name });
}
