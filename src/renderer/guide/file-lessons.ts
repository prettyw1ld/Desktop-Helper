// Уроки про файлы: сначала открываем настоящую папку (Finder или Проводник), потом ведём по шагам.
import { api } from '../core/api';
import { T } from '../core/i18n';
import { isMac, setSkills } from '../core/settings';
import { hideBubble, say, type Action } from '../ui/bubble';
import { closePanels, showPanel } from '../ui/panels';
import { runScenario } from './coach';
import * as Scenarios from './scenarios';

let launch = 0;

const backToLessons = (): Action => [T('files.menu'), () => { hideBubble(); showPanel('lessons'); }];

export async function startFileLesson(id: string): Promise<void> {
  const mine = ++launch;
  closePanels();
  const sc = Scenarios.list.find((s) => s.id === id);
  if (!sc) return;
  if (isMac()) {
    const access = await api.filesAction({ op: 'access' });
    if (mine !== launch) return;
    if (!access.trusted) {
      say(T('files.access'), Infinity, {
        guide: true,
        actions: [
          [T('files.permissions'), () => { void api.filesAction({ op: 'permissions' }); }, true],
          [T('files.retry'), () => { void startFileLesson(id); }],
          backToLessons(),
        ],
      });
      return;
    }
  }
  say(T('files.opening'), Infinity, { guide: true });
  const result = await api.filesAction({ op: 'open', place: sc.place });
  if (mine !== launch) return;
  if (result.error) {
    say(T('files.error'), Infinity, { guide: true, actions: [[T('g.retry'), () => { void startFileLesson(id); }, true], backToLessons()] });
    return;
  }
  // Окно с папкой может ещё открываться: опрос сам найдёт кнопки, когда оно появится.
  runScenario(sc);
}

// «Открыть свой документ»: привычное окно выбора файла, без подсветки
export async function chooseDocument(): Promise<void> {
  closePanels();
  say(T('files.chooseNow'), Infinity, { guide: true });
  const result = await api.filesAction({ op: 'choose' });
  if (result.error) say(T('files.error'), 6000, { guide: true, actions: [backToLessons()] });
  else if (result.canceled) say(T('files.canceled'), 5000);
  else {
    say(T('files.opened'), 5000);
    setSkills(await api.addSkill(T('files.chooseSkill')));
  }
}
