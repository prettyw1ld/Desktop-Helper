import { I18N, T } from '../../shared/i18n';

export { I18N, T };

/** Подставляет тексты в разметку: data-i18n, data-i18n-ph, data-i18n-title. */
export function applyI18n(doc: Document): void {
  doc.querySelectorAll<HTMLElement>('[data-i18n]').forEach((e) => { e.textContent = T(e.dataset.i18n ?? ''); });
  doc.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((e) => { e.placeholder = T(e.dataset.i18nPh ?? ''); });
  doc.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((e) => { e.title = T(e.dataset.i18nTitle ?? ''); });
  doc.documentElement.lang = I18N.lang;
}

/** Строка для дат и времени в языке кота. */
export const locale = (): string => (I18N.lang === 'en' ? 'en-US' : 'ru-RU');
