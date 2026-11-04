// Чем кот сейчас занят с человеком: ведёт по шагам, объясняет элемент, учит мышке.
import type { LookResult } from '../../shared/types';

/**
 * ai — подсказки ИИ по снимку экрана; script — готовый урок (coach.ts);
 * lost — «Я запутался» без ИИ; inspect — «Объясни, что это».
 */
export type GuideKind = 'ai' | 'script' | 'lost' | 'inspect';

export const guide = {
  active: false,
  kind: 'ai' as GuideKind,
  goal: '',
  history: [] as string[],        // подсказки, которые уже были (для ИИ)
  plan: [] as string[],           // весь путь к цели, который ИИ продумал заранее
  stepIndex: 0,                   // какой сейчас шаг плана, с 1
  last: null as LookResult | null,
  busy: false,                    // ждём ответ ИИ
  mode: '',                       // режим последнего запроса к ИИ
  screenSummary: '',              // что было на экране в прошлый раз (для «что изменилось»)
  stepAt: 0,                      // когда показали шаг
  autoChecked: false,             // уже сами проверили этот шаг после смены экрана
};

/** Тренажёр мыши: click → dbl → drag → landing. */
export type TrainerStep = 'click' | 'dbl' | 'drag' | 'landing';
export const trainer = { step: null as TrainerStep | null };

export const busyWithPerson = (): boolean => guide.active || !!trainer.step;
