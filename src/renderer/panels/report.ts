// «Сообщить об инциденте» из пакета организации: вопросы по одному, ответ кнопкой
// или своими словами, в конце готовый текст. Пушик ничего не отправляет сам:
// текст можно скопировать или открыть черновиком письма.
import type { PackReport } from '../../shared/types';
import { composeReport } from '../../shared/report';
import { api } from '../core/api';
import { $, el } from '../core/dom';
import { I18N, T } from '../core/i18n';
import { settings } from '../core/settings';
import { registerPanel, showPanel } from '../ui/panels';

const state = { report: null as PackReport | null, i: 0, answers: [] as string[] };

/** Слова, по которым голосом или текстом открывается отчёт. */
export const REPORT_WORDS = /инцидент|сообщ.{0,20}(безопасн|взлом|вирус)|взлом|заражен|incident|report.{0,20}(security|hack|virus)/i;

export function openReport(id?: string): boolean {
  const r = settings.packReports.find((x) => !id || x.id === id);
  if (!r) return false;
  Object.assign(state, { report: r, i: 0, answers: [] });
  showPanel('report');
  return true;
}

const lang = (): 'ru' | 'en' => (I18N.lang === 'en' ? 'en' : 'ru');

function button(text: string, cls: string, fn: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function render(): void {
  const r = state.report;
  if (!r) return;
  $('#rep-title').textContent = r.title[lang()];
  const body = $('#rep-body');
  body.replaceChildren();
  if (state.i >= r.questions.length) { renderDone(r, body); return; }
  const q = r.questions[state.i]!;
  if (state.i === 0 && r.intro) body.append(el('p', 'sub', r.intro));
  body.append(el('div', 'sub rep-step', T('rep.step', { n: state.i + 1, all: r.questions.length })), el('p', 'rep-ask', q.ask));
  const next = (answer: string) => { state.answers[state.i] = answer; state.i++; render(); };
  if (q.options.length) {
    const opts = el('div', 'rep-options');
    for (const o of q.options) opts.append(button(o, 'big', () => next(o)));
    body.append(opts);
  }
  const input = el('textarea', 'rep-input') as HTMLTextAreaElement;
  input.rows = 3;
  input.placeholder = T(q.options.length ? 'rep.other' : 'rep.ph');
  input.value = state.answers[state.i] && !q.options.includes(state.answers[state.i]!) ? state.answers[state.i]! : '';
  const nav = el('div', 'row rep-nav');
  if (state.i > 0) nav.append(button(T('rep.back'), 'ghost', () => { state.i--; render(); }));
  nav.append(button(T('g.next'), 'primary', () => next(input.value)));
  body.append(input, nav);
  setTimeout(() => { if (!q.options.length) input.focus(); }, 50);
}

function renderDone(r: PackReport, body: HTMLElement): void {
  const draft = composeReport(r, state.answers, { host: settings.host, when: new Date(), lang: lang() });
  const text = el('textarea', 'rep-result') as HTMLTextAreaElement;
  text.readOnly = true;
  text.rows = 9;
  text.value = draft.body;
  const status = el('div', 'sub rep-status');
  status.setAttribute('role', 'status');
  const nav = el('div', 'row rep-nav');
  nav.append(button(T('rep.copy'), 'primary', () => {
    void api.copyText(`${draft.subject}\n\n${draft.body}`).then(() => { status.textContent = T('rep.copied'); });
  }));
  if (draft.mailto) {
    nav.append(button(T('rep.mail'), 'ghost', () => {
      void api.openUri(draft.mailto).then((ok) => { status.textContent = T(ok ? 'rep.mailed' : 'rep.noMail'); });
    }));
  }
  body.append(el('p', 'rep-ask', T('rep.done')), text, nav, status, el('p', 'sub', r.to ? T('rep.sendTo', { to: r.to }) : T('rep.sendSelf')));
}

export function initReport(): void {
  registerPanel('report', { show: render });
}
