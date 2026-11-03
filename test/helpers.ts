// Помощники для тестов окна кота.
import type { LocateItem, LocateQuery, LocateResult, LocateWindow } from '../src/shared/types';
import { cat } from '../src/renderer/cat/cat';
import { api } from '../src/renderer/core/api';
import { dom } from '../src/renderer/core/dom';
import { DEFAULT_SETTINGS, setSettings } from '../src/renderer/core/settings';
import { Sound } from '../src/renderer/core/sound';

/** Тестовый «рабочий стол»: какое окно сверху и какие кнопки находит поиск. */
export const desk = {
  top: { proc: 'Finder', title: 'Пушик — учимся работать с файлами' } as LocateWindow,
  items: [] as LocateItem[],
  requests: [] as LocateQuery[],
};

export function resetDesk(platform = 'darwin'): void {
  setSettings({ ...DEFAULT_SETTINGS, platform, locator: true, lang: 'ru' });
  Sound.set(false);
  desk.top = { proc: 'Finder', title: 'Пушик — учимся работать с файлами' };
  desk.items = [];
  desk.requests = [];
  api.locate = async (q): Promise<LocateResult> => {
    desk.requests.push(q);
    return q.op === 'top' || q.op === 'window' ? { win: desk.top } : { items: desk.items };
  };
  api.filesAction = async () => ({ trusted: true, ok: true });
  api.addSkill = async () => [];
  Object.assign(cat, { state: 'busy', x: 200, y: 400, plat: null, jump: null, onArrive: null, lookUntil: 0 });
}

/** Дать отработать всем ожидающим промисам. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

/** Кот допрыгнул, куда прыгал (в тестах нет кадров анимации). */
export function land(): void {
  const after = cat.jump?.after;
  if (cat.jump) cat.jump.after = null;
  after?.();
}

export const bubbleText = (): string => (dom.bubble.classList.contains('hidden') ? '' : dom.bubbleText.textContent ?? '');
export const ringShown = (): boolean => !dom.ring.classList.contains('hidden');
