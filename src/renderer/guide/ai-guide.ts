// Помощник с ИИ: снимок экрана → кот показывает лапкой, куда нажать, и сам проверяет, получилось ли.
import { isError, type LookMode, type LookResult } from '../../shared/types';
import { cat, setState, startFall } from '../cat/cat';
import { celebrate, showPose } from '../cat/poses';
import { api } from '../core/api';
import { dom } from '../core/dom';
import { T } from '../core/i18n';
import { setSkills } from '../core/settings';
import { Sound } from '../core/sound';
import { say, type Action } from '../ui/bubble';
import { closePanels } from '../ui/panels';
import { hideRing, showRing } from '../ui/ring';
import { speak, stopSpeaking } from '../ui/speech';
import { endGuide } from './control';
import { goPoint, guideMasks } from './pointing';
import { guide } from './state';
import { endTrainer } from './trainer';

// Следим за экраном после подсказки: если он заметно поменялся, сами проверяем шаг.
function watchScreen(): void {
  api.guideUnwatch();
  // ждём, пока кот допрыгнет и облачко встанет на место
  setTimeout(() => { if (guide.active && !guide.busy) api.guideWatch(guideMasks()); }, 900);
  guide.stepAt = Date.now();
  guide.autoChecked = false;
}

const WHAT_HAPPENED = 'Что сейчас произошло?';

export function aiStepActions(): Action[] {
  const actions: Action[] = [
    [T('g.done'), () => look('check'), true],
    [T('g.again'), () => { if (guide.last) showStep(guide.last); }],
    [T('g.stop'), () => endGuide(true)],
  ];
  const changed = guide.last?.whatChanged;
  if (changed) actions.splice(1, 0, [WHAT_HAPPENED, () => showChange(changed, () => { if (guide.last) showStep(guide.last); })]);
  return actions;
}

function showChange(text: string, back: () => void): void {
  say(text, Infinity, { guide: true, actions: [['Повторить', () => speak(text)], ['Назад', back], ['Завершить', () => endGuide(false)]] });
  speak(text);
}

/** «Шаг 2 из 5», если ИИ продумал путь заранее. */
export function stepLabel(): string {
  const n = guide.plan.length;
  const i = guide.stepIndex;
  return n >= 2 && i >= 1 && i <= n ? T('g.stepOf', { i, n }) : '';
}

// Кнопку не нашли через «доступность», место только угадано: честно говорим «примерно здесь».
const approxOf = (res: LookResult): boolean => !!res.target && !res.snapped;

function showStep(res: LookResult): void {
  guide.last = res;
  const approx = approxOf(res);
  showRing(res.target, approx);
  const sayIt = () => {
    say(res.say, Infinity, { actions: aiStepActions(), guide: true, step: stepLabel(), explain: approx ? T('g.approx') : undefined });
    speak(res.say);
    watchScreen();
  };
  if (res.target) goPoint(res.target, sayIt);
  else { setState('busy'); sayIt(); }
}

/** Повторить текущую подсказку (после переноса кота). */
export function repeatAiStep(): void {
  const last = guide.last;
  if (last?.say) say(last.say, Infinity, { guide: true, actions: aiStepActions(), step: stepLabel(), explain: approxOf(last) ? T('g.approx') : undefined });
}

async function done(res: LookResult): Promise<void> {
  hideRing();
  const skill = res.skill || guide.goal;
  const completion = `${res.say || T('g.success')}\n${T('g.skillSaved')}`;
  const close: Action = ['Закрыть', () => endGuide(false)];
  const changed = res.whatChanged;
  const actions: Action[] = changed
    ? [[WHAT_HAPPENED, () => showChange(changed, () => say(completion, Infinity, { guide: true, actions: [close] }))], close]
    : [];
  say(completion, actions.length ? Infinity : 7000, { guide: true, actions });
  speak(res.say || T('g.success'));
  celebrate();
  guide.active = false;
  setTimeout(() => { if (cat.state === 'perch') startFall(); }, 2500);
  if (skill) setSkills(await api.addSkill(skill));
}

function explain(res: LookResult): void {
  const danger = res.status === 'danger';
  showRing(res.target);
  const go = () => { if (guide.goal) look('check'); else endGuide(false); };
  const text = danger ? `${T('g.danger')} ${res.say}` : res.say;
  const show = () => {
    say(text, Infinity, { actions: [[T('g.ok'), go, true], [T('g.stop'), () => endGuide(true)]], guide: true, explain: res.explain, danger });
    speak(`${res.explain || ''} ${res.say}`);
  };
  if (danger) Sound.hiss();
  if (res.target) goPoint(res.target, show); else show();
  if (danger) setTimeout(() => { if (cat.state !== 'perch') showPose('angry', 1600); }, 50);
}

export async function look(mode: LookMode): Promise<void> {
  if (guide.busy) return;
  guide.busy = true;
  guide.mode = mode;
  api.guideUnwatch();
  stopSpeaking();
  hideRing();
  dom.cat.classList.add('thinking');
  if (cat.state !== 'perch' && !['fall', 'jump'].includes(cat.state)) setState('busy');
  say(T(mode === 'check' ? 'g.checking' : 'g.looking'), Infinity, { guide: true });
  const res = await api.guideLook({ mode, goal: guide.goal, history: guide.history, previousSummary: guide.screenSummary, plan: guide.plan });
  dom.cat.classList.remove('thinking');
  guide.busy = false;
  if (!guide.active) return;
  if (isError(res)) {
    say(res.error, Infinity, { actions: [[T('g.retry'), () => look(mode), true], [T('g.stop'), () => endGuide(true)]], guide: true });
    speak(res.error);
    return;
  }
  if (res.screenSummary) guide.screenSummary = res.screenSummary;
  if (res.plan?.length) guide.plan = res.plan;
  if (res.stepIndex) guide.stepIndex = res.stepIndex;
  switch (res.status) {
    case 'step':
      if (res.say) guide.history.push(res.say);
      showStep(res);
      break;
    case 'done':
      await done(res);
      break;
    case 'explain':
    case 'danger':
      explain(res);
      break;
    default:
      hideRing();
      say(res.say || T('g.notFound'), Infinity, {
        actions: [[T('g.retry'), () => look(guide.history.length ? 'check' : 'start'), true], [T('g.stop'), () => endGuide(true)]],
        guide: true,
      });
      speak(res.say || T('g.notFound'));
  }
}

/** Начать подсказки ИИ к цели. */
export function startGuide(goal: string, mode: LookMode = 'start'): void {
  goal = String(goal || '').trim();
  if (!goal) return;
  closePanels();
  endTrainer();
  Object.assign(guide, { active: true, kind: 'ai', goal, history: [], plan: [], stepIndex: 0, screenSummary: '', last: null, busy: false });
  look(mode);
}

/** «Я запутался» с ИИ: что сейчас на экране и как вернуться. */
export function imLostAI(): void {
  closePanels();
  endTrainer();
  if (!guide.active) Object.assign(guide, { goal: '', history: [], plan: [], stepIndex: 0, kind: 'ai' });
  guide.active = true;
  guide.busy = false;
  look('confused');
}

export function initAiGuide(): void {
  // бесплатный ИИ попросил подождать: кот говорит, что думает, вместо тишины
  api.on('ai-wait', (sec) => say(T('ai.wait', { sec }), (sec + 1) * 1000, { guide: true }));
  // Экран заметно поменялся после подсказки: сами проверяем, получилось ли.
  // Не больше одного раза на шаг и не раньше чем через 3 с:
  // иначе любое движение на экране (видео, прокрутка) заставляет кота говорить без спроса.
  api.on('screen-changed', () => {
    if (!guide.active || guide.busy || guide.kind !== 'ai' || guide.mode === 'confused') return;
    if (guide.autoChecked || Date.now() - guide.stepAt < 3000) return;
    guide.autoChecked = true;
    api.guideUnwatch();
    setTimeout(() => { if (guide.active && !guide.busy) look('check'); }, 1200);
  });
}
