// Чат с котом (если у команды есть ИИ).
import { isError } from '../../shared/types';
import { happy } from '../cat/poses';
import { startGuide } from '../guide/ai-guide';
import { api } from '../core/api';
import { $, dom, el } from '../core/dom';
import { T } from '../core/i18n';
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
    const typing = addMsg('from-cat typing', T('chat.thinking'));
    dom.cat.classList.add('thinking');
    const res = await api.chat(text);
    dom.cat.classList.remove('thinking');
    typing.remove();
    if (isError(res)) { addMsg('err', res.error); return; }
    addMsg('from-cat', res.reply);
    // «Как сделать…»: не простыня текста, а показ лапкой на экране, шаг за шагом
    if (res.show) { const goal = res.show; setTimeout(() => startGuide(goal), 700); return; }
    happy(800);
    if (res.actions.length) void refreshReminders();
  });
  $('[data-reset]').addEventListener('click', async () => {
    await api.resetChat();
    log().replaceChildren();
    addMsg('from-cat', T('chat.fresh'));
  });
}
