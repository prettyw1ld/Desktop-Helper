// Чат с котом (если у команды есть ИИ).
import { isError } from '../../shared/types';
import { happy } from '../cat/poses';
import { goalFromHowTo, isHowTo, vagueGoal } from '../../shared/howto';
import { routeGoal, startScenario } from '../guide/router';
import { matchPack } from '../guide/scenarios';
import { api } from '../core/api';
import { $, dom, el } from '../core/dom';
import { I18N, T } from '../core/i18n';
import { registerPanel } from '../ui/panels';
import { refreshReminders } from './reminders';

const log = () => $('#chat-log');

export function addMsg(cls: string, text: string): HTMLElement {
  const d = el('div', `msg ${cls}`, text);
  log().append(d);
  log().scrollTop = log().scrollHeight;
  return d;
}

export function initChat(): void {
  const input = $<HTMLInputElement>('#chat-input');
  registerPanel('chat', { show: () => setTimeout(() => input.focus(), 50) });
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('me', text);
    // Урок организации на эту фразу («мне пришло странное письмо», «где чат ИБ») ведём сами, без запроса к ИИ:
    // так ответ всегда тот, что задал отдел безопасности, и ничего с экрана не уходит наружу
    const own = matchPack(text);
    if (own) {
      addMsg('from-cat', own.reply || T('chat.showing', { goal: own.skill[I18N.lang] || own.skill.ru }));
      setTimeout(() => startScenario(own), 700);
      return;
    }
    // «Покажи, как…» узнаём сами и сразу ведём по экрану: ИИ не всегда слушается и пишет шаги текстом
    // «как это сделать?» без самой задачи: пусть ИИ вспомнит задачу из прошлых сообщений
    if (isHowTo(text) && !vagueGoal(goalFromHowTo(text))) {
      const goal = goalFromHowTo(text);
      addMsg('from-cat', T('chat.showing', { goal }));
      setTimeout(() => routeGoal(goal), 700);
      return;
    }
    const typing = addMsg('from-cat typing', T('chat.thinking'));
    dom.cat.classList.add('thinking');
    const res = await api.chat(text);
    dom.cat.classList.remove('thinking');
    typing.remove();
    if (isError(res)) { addMsg('err', res.error); return; }
    addMsg('from-cat', res.reply);
    // «Как сделать…»: не простыня текста, а показ лапкой на экране, шаг за шагом (готовый урок, если есть)
    if (res.show) { const goal = res.show; setTimeout(() => routeGoal(goal), 700); return; }
    happy(800);
    if (res.actions.length) void refreshReminders();
  });
  $('[data-reset]').addEventListener('click', async () => {
    await api.resetChat();
    log().replaceChildren();
    addMsg('from-cat', T('chat.fresh'));
  });
}
