// Помощник с ИИ: снимок экрана → кот показывает лапкой, куда нажать, и сам проверяет, получилось ли.
import { isError, type LookMode, type LookResult, type Rect } from '../../shared/types';
import { cat, setState, startFall } from '../cat/cat';
import { celebrate, showPose } from '../cat/poses';
import { api } from '../core/api';
import { dom } from '../core/dom';
import { T } from '../core/i18n';
import { setSettings, setSkills, settings } from '../core/settings';
import { Sound } from '../core/sound';
import { hideBubble, say, setBubbleAvoid, type Action, type SayOptions } from '../ui/bubble';
import { openedZone, targetZones } from '../ui/bubble-spot';
import { closePanels, showPanel } from '../ui/panels';
import { hideRing, showRing } from '../ui/ring';
import { speak, stopSpeaking } from '../ui/speech';
import { endGuide, onGuideEnd } from './control';
import { goPoint, guideMasks, stepAside } from './pointing';
import { guide } from './state';
import { endTrainer } from './trainer';

// Следим за экраном после подсказки: если он заметно поменялся, сами проверяем шаг.
// Главное — нажатия мышью: нажал человек куда-то мимо кота и облачка — значит, что-то сделал, проверяем.
// Сравнение снимков остаётся для того, что делают клавиатурой (меню на светлом фоне оно часто не замечает).
let stepShown = false;
let clickTimer: ReturnType<typeof setTimeout> | null = null;

function watchScreen(): void {
  api.guideUnwatch();
  // ждём, пока кот допрыгнет и облачко встанет на место
  setTimeout(() => { if (guide.active && !guide.busy) api.guideWatch(guideMasks()); }, 900);
  guide.stepAt = Date.now();
  guide.autoChecked = false;
  stepShown = true;
  holdScreen(true);
}

// Пока кот ведёт по шагам: ждём нажатий мышью, а нажатия по облачку не забирают фокус у программы человека
// (иначе её открытое меню закрывается от нажатия на «Сделал(а)»).
let holding = false;
function holdScreen(on: boolean): void {
  if (on) api.watchClicks(true, 'guide');  // продлевает слежку на каждом шаге
  if (on === holding) return;
  holding = on;
  if (!on) api.watchClicks(false, 'guide');
  api.setFocusable(!on);
}

function stopWatching(): void {
  stepShown = false;
  reshow = null;
  setBubbleAvoid([]);
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = null;
  holdScreen(false);
}

onGuideEnd(stopWatching);

/** Нажатие пришлось на кнопку из подсказки (место угадано примерно — рамка шире). */
function hitsTarget(p: { x: number; y: number }): boolean {
  const t = guide.last?.target;
  if (!t) return false;
  const pad = guide.last && approxOf(guide.last) ? 36 : 14;
  return p.x >= t.x - pad && p.x <= t.x + t.w + pad && p.y >= t.y - pad && p.y <= t.y + t.h + pad;
}

/** Нажали мышью где-то на экране (x, y — в координатах окна кота). */
export function onScreenClick(p: { x: number; y: number } | null): void {
  if (!guide.active || guide.busy || guide.kind !== 'ai' || !stepShown) return;
  // нажали по коту, облачку или окну Пушика: это не действие в программе
  if (p && document.elementFromPoint(p.x, p.y)?.closest('.hit')) return;
  if (Date.now() - guide.stepAt < 600) return;
  stepShown = false;
  guide.autoChecked = true;
  api.guideUnwatch();
  const onTarget = !!p && hitsTarget(p);
  // даём меню или окну открыться, потом смотрим
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { clickTimer = null; if (guide.active && !guide.busy) look('check', { onTarget }); }, 900);
}

// Что сейчас написано в облачке подсказки: после переноса кота показываем то же самое, а не прошлый шаг.
let reshow: (() => void) | null = null;
function tell(text: string, opts: SayOptions): void {
  reshow = () => say(text, Infinity, opts);
  reshow();
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
  tell(text, { guide: true, actions: [['Повторить', () => speak(text)], ['Назад', back], ['Завершить', () => endGuide(false)]] });
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
    tell(res.say, { actions: aiStepActions(), guide: true, step: stepLabel(), explain: approx ? T('g.approx') : undefined });
    speak(res.say);
    watchScreen();
  };
  if (res.target) goPoint(res.target, sayIt);
  else { setState('busy'); sayIt(); }
}

/** Снова показать то, что кот говорил только что (после переноса кота или нажатия на него). */
export function repeatAiStep(): boolean {
  if (guide.busy || !reshow) return false;
  reshow();
  return true;
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
  stopWatching();
  setTimeout(() => { if (cat.state === 'perch') startFall(); }, 2500);
  if (skill) setSkills(await api.addSkill(skill));
}

function explain(res: LookResult): void {
  const danger = res.status === 'danger';
  showRing(res.target);
  const go = () => { if (guide.goal) look('check'); else endGuide(false); };
  const text = danger ? `${T('g.danger')} ${res.say}` : res.say;
  const show = () => {
    tell(text, { actions: [[T('g.ok'), go, true], [T('g.stop'), () => endGuide(true)]], guide: true, explain: res.explain, danger });
    speak(`${res.explain || ''} ${res.say}`);
  };
  if (danger) Sound.hiss();
  if (res.target) goPoint(res.target, show); else show();
  if (danger) setTimeout(() => { if (cat.state !== 'perch') showPose('angry', 1600); }, 50);
}

// ---------- Что открылось: рассказ по уровням ----------
// Нажал человек кнопку, и открылось меню или окно: кот рассказывает, что в нём главное,
// а по «Подробнее» — следующие пункты, пока есть что рассказать. «Понятно» — дальше по шагам.
const tour = { told: [] as string[], level: 0, after: null as LookResult | null };

/** Облачко и кот не закрывают то, что открылось (box), а если место неизвестно — кнопку и место под её меню. */
function keepOpenedClear(box: Rect | null | undefined, pressed: Rect | null | undefined): void {
  const big = !!box && box.w * box.h > innerWidth * innerHeight * 0.55;
  if (box && !big) {
    setBubbleAvoid([openedZone(box), ...(pressed ? targetZones(pressed, innerHeight).slice(0, 1) : [])]);
    stepAside(box);
  } else {
    setBubbleAvoid(pressed && !big ? targetZones(pressed, innerHeight) : []);
  }
}
const MAX_LEVEL = 4;

function showOpened(text: string, res: LookResult): void {
  const after = tour.after;
  hideRing();
  const actions: Action[] = [];
  if (res.hasMore !== false && tour.level < MAX_LEVEL) actions.push([tour.level <= 1 ? 'Подробнее' : 'Ещё подробнее', () => void look('more'), true]);
  const practice = res.practiceGoal;
  if (practice) actions.push(['Попробовать', () => startGuide(practice, 'practice')]);
  actions.push(['Понятно', () => { if (after) carryOn(after); else endGuide(false); }, !actions.length]);
  tell(text, { guide: true, actions });
  speak(text);
}

/** Обычный ответ ИИ: следующий шаг, цель достигнута, объяснение или «не нашёл». */
function carryOn(res: LookResult): void {
  switch (res.status) {
    case 'step':
      if (res.say) guide.history.push(res.say);
      showStep(res);
      break;
    case 'done':
      void done(res);
      break;
    case 'explain':
    case 'danger':
      explain(res);
      break;
    default:
      hideRing();
      tell(res.say || T('g.notFound'), {
        actions: [[T('g.retry'), () => look(guide.history.length ? 'check' : 'start'), true], [T('g.stop'), () => endGuide(true)]],
        guide: true,
      });
      speak(res.say || T('g.notFound'));
  }
}

export async function look(mode: LookMode, click?: { onTarget: boolean }): Promise<void> {
  if (guide.busy) return;
  guide.busy = true;
  guide.mode = mode;
  stepShown = false;
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = null;
  api.guideUnwatch();
  stopSpeaking();
  hideRing();
  dom.cat.classList.add('thinking');
  if (cat.state !== 'perch' && !['fall', 'jump'].includes(cat.state)) setState('busy');
  say(T(mode === 'check' ? 'g.checking' : 'g.looking'), Infinity, { guide: true });
  const more = mode === 'more';
  const pressed = guide.last?.target;
  const res = await api.guideLook({
    mode, goal: guide.goal, previousSummary: guide.screenSummary, plan: guide.plan, click,
    history: more ? [...tour.told] : guide.history,
    level: more ? tour.level + 1 : undefined,
  });
  dom.cat.classList.remove('thinking');
  guide.busy = false;
  if (!guide.active) return;
  if (isError(res)) {
    tell(res.error, { actions: [[T('g.retry'), () => look(mode), true], [T('g.stop'), () => endGuide(true)]], guide: true });
    speak(res.error);
    return;
  }
  if (more) {
    const text = res.opened || (tour.level ? res.explain : '') || '';
    // спросили, что открылось, а ничего не открылось: идём дальше по шагам
    if (!text && !tour.level && tour.after) { carryOn(tour.after); return; }
    tour.level++;
    if (text) tour.told.push(text);
    showOpened(text || 'Больше тут рассказывать нечего.', text ? res : { ...res, hasMore: false, practiceGoal: '' });
    return;
  }
  // после нажатия: не закрываем то, что открылось; в остальных случаях ограничение снимаем
  if (mode === 'check' && click) keepOpenedClear(res.openedBox, pressed);
  else setBubbleAvoid([]);
  if (res.screenSummary) guide.screenSummary = res.screenSummary;
  if (res.plan?.length) guide.plan = res.plan;
  if (res.stepIndex) guide.stepIndex = res.stepIndex;
  // открылось меню или окно: сначала рассказываем, что в нём, потом — дальше по шагам
  if (res.opened && (res.status === 'step' || res.status === 'done')) {
    Object.assign(tour, { told: [res.opened], level: 1, after: res });
    showOpened(res.opened, res);
    return;
  }
  // человек нажал выделенную кнопку, а модель не рассказала, что открылось: спрашиваем об этом отдельно
  if ((click?.onTarget || (click && res.openedBox)) && (res.status === 'step' || res.status === 'done')) {
    Object.assign(tour, { told: [], level: 0, after: res });
    await look('more');
    return;
  }
  carryOn(res);
}

/** Начать подсказки ИИ к цели. */
/** Снимок всего экрана уходит на сервер ИИ: в первый раз спрашиваем разрешения. */
function withShotConsent(go: () => void): void {
  if (settings.shotConsent) { go(); return; }
  closePanels();
  endTrainer();
  const text = T('shot.ask');
  const yes = () => {
    guide.active = false;
    settings.shotConsent = true;
    void api.saveSettings({ shotConsent: true }).then(setSettings);
    go();
  };
  const no = () => { guide.active = false; hideBubble(); showPanel('lessons'); };
  guide.active = true;  // пока ждём ответа, случайные фразы не перебивают вопрос
  say(text, Infinity, { guide: true, explain: T('shot.tip'), actions: [[T('shot.yes'), yes, true], [T('shot.no'), no]] });
  speak(text);
}

export function startGuide(goal: string, mode: LookMode = 'start'): void {
  goal = String(goal || '').trim();
  if (!goal) return;
  withShotConsent(() => {
    closePanels();
    endTrainer();
    Object.assign(guide, { active: true, kind: 'ai', goal, history: [], plan: [], stepIndex: 0, screenSummary: '', last: null, busy: false });
    look(mode);
  });
}

/** «Я запутался» с ИИ: что сейчас на экране и как вернуться. */
export function imLostAI(): void {
  withShotConsent(() => {
    closePanels();
    endTrainer();
    if (!guide.active) Object.assign(guide, { goal: '', history: [], plan: [], stepIndex: 0, kind: 'ai' });
    guide.active = true;
    guide.busy = false;
    look('confused');
  });
}

export function initAiGuide(): void {
  api.on('global-click', onScreenClick);
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
