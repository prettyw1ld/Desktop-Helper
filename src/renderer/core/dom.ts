// Доступ к разметке окна кота (index.html).

/** Элемент по селектору. Если его нет в разметке, это ошибка в index.html: падаем сразу и понятно. */
export function $<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`index.html: no element ${sel}`);
  return el;
}

export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll<T>(sel)];

/** Новый элемент с классом и текстом. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Часто нужные части окна. */
export const dom = {
  cat: $('#cat'),
  bubble: $('#bubble'),
  bubbleText: $('#bubble-text'),
  bubbleActions: $('#bubble-actions'),
  fx: $('#fx'),
  badge: $('#focus-badge'),
  ring: $('#ring'),
  sprite: $<HTMLCanvasElement>('#sprite'),
};

export const isHidden = (e: Element): boolean => e.classList.contains('hidden');
