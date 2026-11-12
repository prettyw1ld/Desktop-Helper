// Что человек сказал или написал → готовый урок, иначе ИИ (если есть), иначе честное «не знаю».
import { T } from '../core/i18n';
import { can } from '../core/settings';
import { micState } from '../panels/mic';
import { openReport, REPORT_WORDS } from '../panels/report';
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

/** Урок по кнопке или по словам. Урок организации без шагов ведёт ИИ, а без ИИ честно говорит, что не может. */
export function startScenario(sc: Scenarios.Scenario): void {
  if (sc.fileLesson) { void startFileLesson(sc.id); return; }
  if (!sc.win?.length && sc.goal) {
    if (can('guide')) { startGuide(sc.goal); return; }
    showPanel('help');
    micState(T('pack.needAi'));
    speak(T('pack.needAi'));
    return;
  }
  runScenario(sc);
}

export function routeGoal(text: string): void {
  if (/помо[гщ].*(файл|проводник|finder)|help with files/i.test(text)) { void startFileLesson('files-learn'); return; }
  if (REPORT_WORDS.test(text) && openReport()) return;
  const m = Scenarios.match(text);
  if (m === Scenarios.LOST) { imLost(); return; }
  if (m && 'match' in m) { startScenario(m); return; }
  if (can('guide')) { startGuide(goalOf(text)); return; }
  showPanel('help');
  micState(T('coach.unknown'));
  speak(T('coach.unknown'));
}

/** «Я запутался»: с ИИ — по снимку экрана, без него — по названию окна сверху. */
export function imLost(): void {
  if (can('guide')) { imLostAI(); return; }
  closePanels();
  endTrainer();
  guide.active = true;
  if (!coach.active) guide.kind = 'lost';
  void lostOffline();
}
