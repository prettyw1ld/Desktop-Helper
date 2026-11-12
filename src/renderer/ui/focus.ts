// Забирает ли окно кота фокус клавиатуры. Только когда человеку надо печатать (чат, настройки,
// напоминания, отчёт, поле задачи). Остальные нажатия по коту и облачкам фокус не трогают:
// у программы человека не закрывается открытое меню, а защита пароля видит поле, где курсор.
import { api } from '../core/api';

const state = { typing: false, hold: false };
let last: boolean | null = null;

function apply(): void {
  const on = state.typing && !state.hold;
  if (on === last) return;
  last = on;
  api.setFocusable(on);
}

/** Открыта панель, где печатают. */
export function setTyping(on: boolean): void { state.typing = on; apply(); }
/** Кот ведёт по шагам: фокус точно не забираем, даже из панели. */
export function setHold(on: boolean): void { state.hold = on; apply(); }
/** При запуске: окно кота фокус не берёт. */
export function initFocus(): void { apply(); }
