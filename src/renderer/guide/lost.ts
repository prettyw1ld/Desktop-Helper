// «Я запутался» без ИИ: какое окно открыто и где у него крестик.
import { cat, startFall } from '../cat/cat';
import { api } from '../core/api';
import { dom } from '../core/dom';
import { T } from '../core/i18n';
import { setSkills, settings } from '../core/settings';
import { hideBubble, say, type Action } from '../ui/bubble';
import { hideRing, showRing } from '../ui/ring';
import { speak } from '../ui/speech';
import { coach, showCoachStep } from './coach';
import { endGuide } from './control';
import { goPoint } from './pointing';
import { guide } from './state';

// Понятные названия программ по имени процесса.
const APP_NAMES: Record<string, string> = {
  chrome: 'браузер Google Chrome, это интернет', msedge: 'браузер Edge, это интернет', firefox: 'браузер Firefox, это интернет',
  browser: 'Яндекс Браузер, это интернет', opera: 'браузер Opera, это интернет', safari: 'браузер Safari, это интернет',
  explorer: 'Проводник, здесь папки и файлы', finder: 'Finder, здесь папки и файлы', whatsapp: 'WhatsApp',
  telegram: 'Telegram', winword: 'Word, здесь пишут тексты', excel: 'Excel, здесь таблицы',
  systemsettings: 'Параметры компьютера', applicationframehost: 'программа Windows', 'system settings': 'Настройки компьютера',
  photos: 'Фотографии', microsoft: 'программа Microsoft', notepad: 'Блокнот', preview: 'Просмотр картинок',
};

export function appName(proc: string, title: string): string {
  const key = proc.toLowerCase();
  return APP_NAMES[key] || Object.entries(APP_NAMES).find(([k]) => key.includes(k))?.[1] || `«${title || proc}»`;
}

export async function lostOffline(): Promise<void> {
  const wasCoach = coach.active;
  clearInterval(coach.poll);
  dom.cat.classList.add('thinking');
  const res = settings.locator ? await api.locate({ op: 'top' }) : {};
  dom.cat.classList.remove('thinking');
  const w = res.win;
  const back = () => {
    hideBubble();
    hideRing();
    if (wasCoach && coach.active) void showCoachStep(true);
    else { guide.active = false; if (cat.state === 'perch') startFall(); }
  };
  const okLost = () => { back(); void api.addSkill(T('les.lost')).then(setSkills); };
  const acts: Action[] = [[T('g.ok'), okLost, true], [T('g.stop'), () => endGuide(true)]];
  if (!w) {
    say(T('lost.desktop'), Infinity, { actions: acts, guide: true });
    speak(T('lost.desktop'));
    return;
  }
  const text = T('lost.window', { name: appName(w.proc || '', w.title || '') });
  const tip = w.close ? T('lost.close') : T('lost.noClose');
  const show = () => { say(text, Infinity, { actions: acts, guide: true, explain: tip }); speak(`${text} ${tip}`); };
  if (w.close) { showRing(w.close); goPoint(w.close, show); } else show();
}
