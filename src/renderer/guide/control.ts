// Конец любой подсказки: ИИ, урока, «Объясни, что это».
import { cat, setState, startFall } from '../cat/cat';
import { api } from '../core/api';
import { dom } from '../core/dom';
import { T } from '../core/i18n';
import { hideBubble, say } from '../ui/bubble';
import { openPanel } from '../ui/panels';
import { hideRing } from '../ui/ring';
import { stopSpeaking } from '../ui/speech';
import { cancelPointGaze } from './pointing';
import { guide } from './state';

const stopHooks: (() => void)[] = [];
/** Что ещё остановить, когда подсказка заканчивается (например, урок). */
export function onGuideEnd(fn: () => void): void { stopHooks.push(fn); }

export function endGuide(sayBye = false): void {
  for (const fn of stopHooks) fn();
  cancelPointGaze();
  guide.active = false;
  guide.last = null;
  api.guideUnwatch();
  stopSpeaking();
  hideRing();
  hideBubble();
  dom.cat.classList.remove('thinking');
  if (sayBye) say(T('g.bye'), 2500);
  if (cat.state === 'perch') startFall();
  else if (cat.state === 'busy' && !openPanel()) setState('idle', 3000);
}
