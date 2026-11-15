// Текст отчёта об инциденте из ответов человека. Пушик его только собирает:
// скопировать или открыть черновиком письма, а отправить — сам человек.
import type { PackReport } from './types';

export interface ReportDraft { subject: string; body: string; mailto: string }

const SKIPPED = { ru: '(нет ответа)', en: '(no answer)' };

export function composeReport(r: PackReport, answers: readonly string[], ctx: { host: string; when: Date; lang: string }): ReportDraft {
  const en = ctx.lang === 'en';
  const title = en ? r.title.en : r.title.ru;
  const when = ctx.when.toLocaleString(en ? 'en-GB' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  const head = [
    `${en ? 'Time' : 'Время'}: ${when}`,
    ctx.host ? `${en ? 'Computer' : 'Компьютер'}: ${ctx.host}` : '',
  ].filter(Boolean);
  const qa = r.questions.map((q, i) => `${i + 1}. ${q.ask}\n${(answers[i] || '').trim() || SKIPPED[en ? 'en' : 'ru']}`);
  const body = [head.join('\n'), ...qa].join('\n\n');
  const subject = ctx.host ? `${title}: ${ctx.host}` : title;
  // письмо открывается черновиком; адрес из пакета уже проверен главным процессом
  const mailto = r.to ? `mailto:${r.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : '';
  return { subject, body, mailto };
}
