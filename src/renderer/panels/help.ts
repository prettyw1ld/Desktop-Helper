// Главное окно новичка «Чем помочь?»: «Объясни, что это», голос и текст.
// Готовые задачи живут в «Уроках». Без ИИ первая большая кнопка ведёт в уроки,
// а если нет микрофона, видно поле, куда можно написать задачу.
import { $ } from '../core/dom';
import { T } from '../core/i18n';
import { can, settings } from '../core/settings';
import { routeGoal } from '../guide/router';
import { setTyping } from '../ui/focus';
import { openPanel, registerPanel, showPanel, isPanel } from '../ui/panels';
import { initMic, micState, refreshMic } from './mic';

/** Без ИИ «Объясни, что это» не сработает, поэтому на её месте — вход в уроки. */
export function firstButton(): HTMLElement {
  const ai = can('inspect');
  const b = $('#inspect-element');
  b.dataset.mode = ai ? 'inspect' : 'lessons';
  b.textContent = T(ai ? 'help.inspect' : 'help.lessons');
  $('.extras [data-act="lessons"]').classList.toggle('hidden', !ai);
  return b;
}

// Поле для текста — запасной путь, когда сказать задачу голосом нельзя.
function showAskIfNoMic(): void {
  const noMic = $('#mic').classList.contains('hidden');
  const form = $('#ask-form');
  form.classList.toggle('hidden', !noMic);
  form.setAttribute('aria-hidden', String(!noMic));
  // без микрофона задачу пишут: тогда окно кота берёт фокус
  if (isPanel('help') && openPanel() === 'help') setTyping(noMic);
}

function renderHelp(): void {
  micState('');
  $('.extras [data-act="chat"]').classList.toggle('hidden', !can('chat'));
  firstButton();
  void refreshMic().then(showAskIfNoMic);
}

export function initHelp(): void {
  registerPanel('help', { show: renderHelp });
  initMic(routeGoal);
  const input = $<HTMLInputElement>('#ask-input');
  $('#ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    input.value = '';
    routeGoal(text);
  });
  $('.extras').addEventListener('click', (e) => {
    const act = (e.target as Element).closest<HTMLElement>('button')?.dataset.act ?? '';
    if (isPanel(act) && ['chat', 'settings', 'lessons'].includes(act)) showPanel(act);
  });
}
