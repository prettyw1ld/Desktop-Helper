// Главное окно новичка «Чем помочь?»: «Объясни, что это», голос и текст.
// Готовые задачи живут в «Уроках».
import { $ } from '../core/dom';
import { settings } from '../core/settings';
import { routeGoal } from '../guide/router';
import { registerPanel, showPanel, isPanel } from '../ui/panels';
import { initMic, micState, refreshMic } from './mic';

function renderHelp(): void {
  micState('');
  $('.extras [data-act="chat"]').classList.toggle('hidden', !settings.aiReady);
  void refreshMic();
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
