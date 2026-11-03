// Что человек сказал или написал → готовый урок, иначе ИИ (если есть), иначе честное «не знаю».
import { T } from '../core/i18n';
import { settings } from '../core/settings';
import { micState } from '../panels/mic';
import { closePanels, showPanel } from '../ui/panels';
import { speak } from '../ui/speech';
import { imLostAI, startGuide } from './ai-guide';
import { coach, runScenario } from './coach';
import { startFileLesson } from './file-lessons';
import { lostOffline } from './lost';
import * as Scenarios from './scenarios';
import { guide } from './state';
import { endTrainer } from './trainer';

// «📞 Позвонить по видео» → «Позвонить по видео»
export const goalOf = (label: string): string => label.replace(/^[^\p{L}\p{N}]+/u, '').trim();

export function routeGoal(text: string): void {
  if (/помо[гщ].*(файл|проводник|finder)|help with files/i.test(text)) { void startFileLesson('files-learn'); return; }
  const m = Scenarios.match(text);
  if (m === Scenarios.LOST) { imLost(); return; }
  if (m && 'match' in m) {
    if (m.fileLesson) void startFileLesson(m.id);
    else runScenario(m);
    return;
  }
  if (settings.aiReady) { startGuide(goalOf(text)); return; }
  showPanel('help');
  micState(T('coach.unknown'));
  speak(T('coach.unknown'));
}

/** «Я запутался»: с ИИ — по снимку экрана, без него — по названию окна сверху. */
export function imLost(): void {
  if (settings.aiReady) { imLostAI(); return; }
  closePanels();
  endTrainer();
  guide.active = true;
  if (!coach.active) guide.kind = 'lost';
  void lostOffline();
}
