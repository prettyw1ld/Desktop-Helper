// Тренажёр мыши: знакомство на самом коте. Нажми → нажми дважды → перетащи → кот приземлился.
import { setTrainerLanding } from '../cat/behaviour';
import { cat, landThen, setState } from '../cat/cat';
import { celebrate } from '../cat/poses';
import { api } from '../core/api';
import { T } from '../core/i18n';
import { setSettings, setSkills, settings } from '../core/settings';
import { hideBubble, say } from '../ui/bubble';
import { closePanels } from '../ui/panels';
import { speak } from '../ui/speech';
import { endGuide } from './control';
import { guide, trainer } from './state';

let onFirstFinish: () => void = () => {};
/** Что сделать после первого прохождения тренажёра (обзор компьютера). */
export function afterFirstTraining(fn: () => void): void { onFirstFinish = fn; }

export function trainerSay(key: string): void {
  say(T(key), Infinity, { guide: true, actions: [[T('g.stop'), () => endTrainer(true)]] });
  speak(T(key));
}

export function startTrainer(): void {
  closePanels();
  if (guide.active) endGuide(false);
  trainer.step = 'click';
  if (cat.plat || cat.state === 'perch') { landThen(() => trainerSay('tr.click')); return; }
  setState('busy');
  trainerSay('tr.click');
}

async function trainerDone(): Promise<void> {
  trainer.step = null;
  setState('idle', 5000);
  celebrate();
  say(`${T('tr.done')}\n${T('g.skillSaved')}`, 8000, { guide: true });
  speak(T('tr.done'));
  setSkills(await api.addSkill(T('tr.skill')));
  if (!settings.onboarded) {
    setSettings(await api.saveSettings({ onboarded: true }));
    setTimeout(() => { if (!guide.active && !trainer.step) onFirstFinish(); }, 6000);
  }
}

export function endTrainer(sayBye = false): void {
  if (!trainer.step) return;
  trainer.step = null;
  hideBubble();
  if (sayBye) say(T('g.bye'), 2000);
  if (!settings.onboarded) void api.saveSettings({ onboarded: true }).then(setSettings);
  if (cat.state === 'busy') setState('idle', 3000);
}

export function initTrainer(): void {
  setTrainerLanding(() => { void trainerDone(); });
}
