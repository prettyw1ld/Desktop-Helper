// «Уроки»: все обучалки по порядку, что пройдено и общий прогресс.
import { $, el } from '../core/dom';
import { I18N, T } from '../core/i18n';
import { settings } from '../core/settings';
import { runScenario } from '../guide/coach';
import { chooseDocument, startFileLesson } from '../guide/file-lessons';
import * as Scenarios from '../guide/scenarios';
import { startTrainer } from '../guide/trainer';
import { icon, type IconName } from '../ui/icons';
import { closePanels, registerPanel } from '../ui/panels';

/** names: название на всех языках, чтобы отметка «пройдено» не терялась при смене языка. */
export interface Lesson { name: string; names: string[]; icon: IconName; start: () => void }

const LESSON_ICONS: Record<string, IconName> = {
  'files-learn': 'folder', 'files-downloads': 'folder', tour: 'paw', photos: 'photos', call: 'call', search: 'search', volume: 'volume', bigger: 'type',
};

export function lessons(): Lesson[] {
  const lang = I18N.lang;
  return [
    { name: T('les.mouse'), names: I18N.all('les.mouse'), icon: 'mouse', start: startTrainer },
    ...Scenarios.list.map((sc): Lesson => ({
      name: sc.skill[lang] || sc.skill.ru,
      names: Object.values(sc.skill),
      icon: LESSON_ICONS[sc.id] || 'paw',
      start: () => { if (sc.fileLesson) void startFileLesson(sc.id); else runScenario(sc); },
    })),
    { name: T('files.chooseSkill'), names: I18N.all('files.chooseSkill'), icon: 'folder', start: () => { void chooseDocument(); } },
  ];
}

function renderLessons(): void {
  const done = new Set((settings.skills || []).map((x) => x.name.toLowerCase()));
  const list = lessons();
  const isDone = (l: Lesson) => l.names.some((n) => done.has(n.toLowerCase()));
  const passed = list.filter(isDone).length;
  $('#les-bar').style.width = `${Math.round((passed / list.length) * 100)}%`;
  $('#les-count').textContent = passed === list.length ? T('les.all') : T('les.progress', { done: passed, all: list.length });
  const ul = $('#les-list');
  ul.replaceChildren();
  for (const l of list) {
    const ok = isDone(l);
    // вся строка — одна большая кнопка: попасть по ней проще, чем по маленькой «Начать»
    const row = el('button', ok ? 'les-row done' : 'les-row');
    row.type = 'button';
    row.insertAdjacentHTML('beforeend', `<span class="les-icon">${icon(ok ? 'check' : l.icon)}</span>`);
    const text = el('span', 'les-text');
    text.append(el('b', '', l.name), el('span', 'sub', T(ok ? 'les.done' : 'les.todo')));
    row.append(text, el('span', 'les-go', T(ok ? 'les.again' : 'les.start')));
    row.addEventListener('click', () => { closePanels(); l.start(); });
    const li = el('li');
    li.append(row);
    ul.append(li);
  }
  // что ещё получилось с ИИ (свободные задачи)
  const names = new Set(list.flatMap((l) => l.names.map((n) => n.toLowerCase())));
  const extra = (settings.skills || []).filter((x) => !names.has(x.name.toLowerCase()));
  if (extra.length) ul.append(el('li', 'les-more sub', `${T('les.more')}: ${extra.map((x) => x.name).join(', ')}`));
}

export function initLessons(): void {
  registerPanel('lessons', { show: renderLessons });
}
