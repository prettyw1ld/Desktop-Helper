/* Ведущий по готовым урокам (scenarios.ts): работает без ИИ и без интернета.
   Кот находит нужную кнопку через системную «доступность», показывает на неё лапкой
   и сам замечает, что шаг сделан (открылось окно, вставили флешку, пропала кнопка). */
import type { LocateItem, LocateQuery } from '../../shared/types';
import { cat, isDragged, startFall } from '../cat/cat';
import { celebrate, happy } from '../cat/poses';
import { api } from '../core/api';
import { $ } from '../core/dom';
import { I18N, T } from '../core/i18n';
import { can, isMac, setSkills, settings } from '../core/settings';
import { Sound } from '../core/sound';
import { pick } from '../core/util';
import { micState } from '../panels/mic';
import { hideBubble, say, type Action } from '../ui/bubble';
import { closePanels, showPanel } from '../ui/panels';
import { hideRing, showRing } from '../ui/ring';
import { speak } from '../ui/speech';
import { endGuide, onGuideEnd } from './control';
import { goPoint } from './pointing';
import * as Scenarios from './scenarios';
import type { Cond, Scenario, Step, StepQuery } from './scenarios';
import { guide, trainer } from './state';
import { endTrainer } from './trainer';

interface Volume { volume: number; muted: boolean }
interface CoachCtx { contact: string; drive?: string; label?: string; vol0?: Volume | null }

export const coach = {
  active: false,
  sc: null as Scenario | null,
  steps: [] as Step[],
  i: -1,
  ctx: { contact: '' } as CoachCtx,
  target: null as LocateItem | null,   // кнопка, на которую сейчас показываем
  seen: false,                         // кнопку текущего шага хоть раз видели (для «кнопка пропала»)
  baseTitle: '',                       // заголовок окна в начале шага (для «заголовок сменился»)
  poll: undefined as ReturnType<typeof setInterval> | undefined,
  polling: false,
  advance: undefined as ReturnType<typeof setTimeout> | undefined,
  advancing: false,                    // шаг сделан, ждём перехода к следующему
  run: 0,                              // номер запуска: ответы от старых запусков отбрасываем
  keepPosition: false,                 // кота перенесли: не прыгать к кнопке заново
  misses: 0,
  warnedAccess: false,
  locateError: '',
  fileError: '',
};

const steps = (sc: Scenario): Step[] => (isMac() ? sc.mac : sc.win) ?? sc.win ?? [];
const current = (): Step | undefined => coach.steps[coach.i];
/** Урок ещё тот же: за время ожидания ответа его не остановили и не перешли дальше. */
const still = (step: Step, run: number): boolean => coach.active && current() === step && coach.run === run;

const stepSay = (step: Step): string => fillText(!coach.ctx.contact && step.sayNoContact ? step.sayNoContact : step.say);
const esc = (s: string | undefined): string => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fillText(s: string): string {
  return String(s || '')
    .replace(/\{contact\}/g, coach.ctx.contact || T('coach.grandson'))
    .replace(/\{drive\}/g, coach.ctx.drive ? `(${coach.ctx.drive}:)` : '')
    .replace(/\{label\}/g, coach.ctx.label || T('coach.usb'))
    .replace(/\s+/g, ' ').trim();
}

function fillQuery(q: StepQuery | undefined): LocateQuery | null {
  if (!q) return null;
  let name = q.name || '';
  if (name.includes('{contact}') && !coach.ctx.contact) return null; // не знаем имени: просто говорим словами
  name = name.replace(/\{contact\}/g, esc(coach.ctx.contact))
    .replace(/\{drive\}/g, esc(coach.ctx.drive || 'Z'))
    .replace(/\{label\}/g, coach.ctx.label ? esc(coach.ctx.label) : 'USB|Съёмный|Removable');
  return { op: 'find', scope: q.scope, name, types: q.types || [], enabled: q.enabled, firstWindow: q.firstWindow };
}

async function locate(q: LocateQuery | null): Promise<LocateItem[]> {
  if (!q || !settings.locator) return [];
  const res = await api.locate(q);
  coach.locateError = res.error || '';
  if (res.error === 'access' && !coach.warnedAccess) {
    coach.warnedAccess = true;
    say(T('coach.noAccess'), 6000, { guide: true });
  }
  const items = res.items || [];
  return q.enabled ? items.filter((it) => it.enabled) : items;
}

async function readVolume(): Promise<Volume | null> {
  const res = settings.locator ? await api.locate({ op: 'volume' }) : {};
  return typeof res.volume === 'number' ? { volume: res.volume, muted: !!res.muted } : null;
}

const FOLDER_TITLES = { practice: 'Пушик — учимся работать с файлами', notes: 'Мои заметки', downloads: 'Загрузки|Downloads' };

/** Выполнено ли условие шага. */
export async function check(cond: Cond | undefined, step?: Step): Promise<boolean> {
  if (!cond) return false;
  if (cond.any) {
    for (const c of cond.any) if (await check(c, step)) return true;
    return false;
  }
  if (cond.manual) return false;
  if (cond.volumeUp || cond.volumeMax) {
    // громкость меряем сами: человеку не надо ничего подтверждать
    const v = await readVolume();
    if (!v) return false;
    if (cond.volumeMax) return !v.muted && v.volume >= 0.97;
    const v0 = coach.ctx.vol0;
    return !!v0 && ((v0.muted && !v.muted) || (!v.muted && v.volume > v0.volume + 0.03));
  }
  if (cond.filePlace) {
    // Окно с папкой: Finder на Mac, Проводник на Windows. Окно кота не мешает: ищем по программе.
    const proc = isMac() ? '^Finder$' : '^explorer$';
    const result = await api.locate({ op: 'window', scope: `proc:${proc}`, firstWindow: true });
    if (result.error) { coach.fileError = result.error; return false; }
    if (cond.foreground) {
      const front = await api.locate({ op: 'top' });
      if (!new RegExp(proc, 'i').test(front.win?.proc || '')) return false;
    }
    return !!result.win && new RegExp(proc, 'i').test(result.win.proc || '')
      && new RegExp(`^(${FOLDER_TITLES[cond.filePlace]})$`, 'i').test(result.win.title || '');
  }
  if (cond.drive) {
    const d = (await api.locate({ op: 'drives' })).drives?.[0];
    if (d) { coach.ctx.drive = d.letter; coach.ctx.label = d.label || ''; }
    return !!d;
  }
  if (cond.top || cond.titleChange) {
    const w = (await api.locate({ op: 'top' })).win;
    if (!w) return false;
    if (cond.top) return new RegExp(cond.top, 'i').test(w.proc || '');
    return !!coach.baseTitle && w.title !== coach.baseTitle;
  }
  if (cond.find) return (await locate(fillQuery(cond.find))).length > 0;
  if (cond.next) {
    const next = coach.steps[coach.i + 1];
    return !!next?.find && (await locate(fillQuery(next.find))).length > 0;
  }
  if (cond.focus) return (await locate(fillQuery(step?.find))).some((it) => it.focused);
  if (cond.gone) return coach.seen && (await locate(fillQuery(step?.find))).length === 0;
  return false;
}

// ---------- Подсказка шага ----------
export function coachStepActions(step: Step): Action[] {
  const sc = coach.sc;
  const fileLesson = !!sc?.fileLesson;
  const mainLabel = fileLesson && step.wait?.manual
    ? (step.find?.types?.includes('Edit') ? 'Нашёл файл' : T('files.next'))
    : T(step.btn || 'g.done');
  const acts: Action[] = [
    [mainLabel, () => { void doneClicked(); }, true],
    [T(fileLesson ? 'files.again' : 'g.again'), () => { void showCoachStep(true); }],
  ];
  if (fileLesson) {
    acts.push([T('files.help'), () => {
      clearInterval(coach.poll);
      hideRing();
      say(stepSay(step), Infinity, {
        guide: true,
        explain: coach.fileError === 'automation' ? T('files.automation') : step.hint,
        actions: [[T('files.again'), () => { void showCoachStep(true); }, true], [T('files.menu'), () => { endGuide(false); showPanel('lessons'); }]],
      });
    }]);
  }
  const folder = step.openFolder;
  if (folder) {
    acts.push(['Открыть папку', async () => {
      const result = await api.filesAction({ op: 'open', place: folder });
      if (!coach.active) return;
      if (result.error) say(T('files.error'), Infinity, { guide: true, actions: coachStepActions(step) });
      else void showCoachStep(true);
    }]);
  }
  if (step.open) acts.push([T('coach.open'), () => { void openForMe(step); }]);
  acts.push([T('g.stop'), () => endGuide(true)]);
  return acts;
}

function coachExplanation(step: Step, missing = false): string {
  if (!coach.sc?.fileLesson) return '';
  const error = coach.locateError;
  const prefix = error === 'access' ? T('files.access')
    : error === 'automation' ? T('files.automation')
      : error && error !== 'no_window' ? T('files.readError')
        : missing ? T('files.missing') : '';
  return [prefix, step.hint].filter(Boolean).join(' ');
}

function coachText(step: Step): string {
  return coach.sc?.fileLesson ? `${T('files.progress', { n: coach.i + 1, total: coach.steps.length })}\n${stepSay(step)}` : stepSay(step);
}

const sayStep = (step: Step, missing = false) =>
  say(coachText(step), Infinity, { actions: coachStepActions(step), guide: true, explain: coachExplanation(step, missing) });

export async function showCoachStep(repeat = false): Promise<void> {
  const run = coach.run;
  const step = current();
  if (!step || !coach.active || coach.advancing || isDragged()) return;
  coach.keepPosition = false;
  const top = step.wait?.titleChange ? await api.locate({ op: 'top' }) : {};
  if (!still(step, run)) return;
  if (!repeat) { coach.baseTitle = top.win?.title || ''; coach.seen = false; coach.misses = 0; }
  const items = await locate(fillQuery(step.find));
  if (!still(step, run)) return;
  coach.target = items[0] ?? null;
  if (isDragged()) return;
  if (coach.target) coach.seen = true;
  if (!coach.target && step.optional && step.find && !repeat) { void nextStep(); return; }
  const sayIt = () => {
    sayStep(step, repeat && !coach.target && !!step.find);
    speak(stepSay(step));
  };
  if (coach.target) {
    showRing(coach.target);
    goPoint(coach.target, () => { if (still(step, run)) sayIt(); });
  } else {
    hideRing();
    if (cat.state === 'perch') startFall();
    sayIt();
  }
  if (repeat) Sound.meow();
  startPoll();
}

// Раз в 1.2 с проверяем, сделан ли шаг, и обновляем рамку вокруг кнопки.
// Кот не заговаривает сам: подсказка просто остаётся на экране, пока человек не нажмёт кнопку.
function startPoll(): void {
  clearInterval(coach.poll);
  coach.poll = setInterval(pollOnce, 1200);
}

async function pollOnce(): Promise<void> {
  if (coach.polling || !coach.active || isDragged()) return;
  coach.polling = true;
  const run = coach.run;
  try {
    const step = current();
    if (!step) return;
    const complete = !step.wait?.manual && await check(step.wait, step);
    if (!still(step, run) || isDragged()) return;
    if (complete) { stepDone(); return; }
    if (!step.find) return;
    const items = await locate(fillQuery(step.find));
    if (!still(step, run) || coach.advancing || isDragged()) return;
    const previous = coach.target;
    coach.target = items[0] ?? null;
    if (coach.target) {
      coach.seen = true;
      coach.misses = 0;
      showRing(coach.target);
      if (!previous) {
        const displayHint = () => { if (still(step, run)) sayStep(step); };
        if (coach.keepPosition) displayHint(); else goPoint(coach.target, displayHint);
      }
    } else {
      hideRing();
      coach.misses++;
      // Finder может ещё открываться: не говорим «кнопки нет» с первой же неудачи
      if (coach.sc?.fileLesson && coach.misses === 3) sayStep(step, true);
    }
  } finally {
    coach.polling = false;
  }
}

function stepDone(): void {
  if (!coach.active || coach.advancing || isDragged()) return;
  coach.advancing = true;
  clearInterval(coach.poll);
  hideRing();
  happy(700);
  Sound.meow();
  clearTimeout(coach.advance);
  coach.advance = setTimeout(() => { void nextStep(); }, 500);
}

async function nextStep(): Promise<void> {
  if (!coach.active) return;
  const run = coach.run;
  coach.advancing = false;
  coach.i++;
  coach.target = null;
  coach.keepPosition = false;
  // шаги, которые уже сделаны (флешка уже вставлена, WhatsApp уже открыт), пропускаем
  while (coach.active && coach.run === run && coach.i < coach.steps.length && await check(current()?.skipIf, current())) coach.i++;
  if (!coach.active || coach.run !== run) return;
  if (coach.i >= coach.steps.length) { void finishScenario(); return; }
  void showCoachStep();
}

/** Человек нажал «Сделал(а)». */
export async function doneClicked(): Promise<void> {
  const run = coach.run;
  const step = current();
  if (!step || coach.advancing || isDragged()) return;
  if (step.wait?.manual) { stepDone(); return; }
  // громкость прочитать не удалось: верим человеку на слово
  if (step.wait?.volumeUp && !coach.ctx.vol0) { stepDone(); return; }
  say(pick(I18N.list('g.checking')), Infinity, { guide: true });
  const complete = step.allowConfirm || await check(step.wait, step) || (!coach.sc?.fileLesson && await check({ next: true }, step));
  if (!still(step, run)) return;
  if (complete) { stepDone(); return; }
  say(T('coach.notYet'), Infinity, { actions: coachStepActions(step), guide: true });
  speak(T('coach.notYet'));
  if (coach.target) goPoint(coach.target);
}

// «Открой за меня»: открываем сами и переходим к шагу, где открытое окно уже нужно.
const AFTER_OPEN: Record<string, string | null> = {
  'ms-settings:easeofaccess-display': 'Slider',
  'ms-settings:sound': 'Slider',
  drive: null,
};

async function openForMe(step: Step): Promise<void> {
  say(T('coach.opening'), 2500, { guide: true });
  if (step.open === 'drive') await api.openDrive(coach.ctx.drive ?? '');
  else await api.openUri(step.open ?? '');
  clearInterval(coach.poll);
  hideRing();
  const want = AFTER_OPEN[step.open ?? ''];
  setTimeout(() => {
    if (!coach.active) return;
    if (want) {
      const j = coach.steps.findIndex((s) => s.find?.types?.includes(want));
      if (j >= coach.i) coach.i = j - 1;
    } else if (step.open === 'drive') {
      const j = coach.steps.findIndex((s, k) => k > coach.i && s.optional);
      if (j > coach.i) coach.i = j - 1;
    }
    void nextStep();
  }, 2500);
}

async function finishScenario(): Promise<void> {
  const sc = coach.sc;
  if (!sc) return;
  stopCoach();
  guide.active = false;
  hideRing();
  const v0 = coach.ctx.vol0;
  const maxed = sc.id === 'volume' && v0 && !v0.muted && v0.volume >= 0.97;
  const text = (maxed && T('coach.volMax')) || sc.done || pick(I18N.list('g.success'));
  say(`${text}\n${T('g.skillSaved')}`, 8000, { guide: true });
  speak(text);
  celebrate();
  setTimeout(() => { if (cat.state === 'perch') startFall(); }, 2500);
  if (sc.id === 'tour') setTimeout(pointToLessons, 4000);
  setSkills(await api.addSkill(sc.skill[I18N.lang] || sc.skill.ru));
}

// После обзора: открываем главное окно и подсвечиваем кнопку «Уроки»
function pointToLessons(): void {
  if (guide.active || trainer.step) return;
  hideBubble();
  showPanel('help');
  const b = can('inspect') ? $('.extras [data-act="lessons"]') : $('#inspect-element');
  b.classList.add('pulse');
  micState(T('les.here'));
  speak(T('les.here'));
  setTimeout(() => b.classList.remove('pulse'), 12000);
}

// Первый запуск: после тренировки мышки сразу обзор компьютера
export function startTourOnce(): void {
  const tour = Scenarios.byId('tour');
  const names = Object.values(tour.skill);
  if ((settings.skills || []).some((x) => names.includes(x.name))) return;
  runScenario(tour);
}

// После переноса сохраняем шаг и выбранное место. Это общая логика для обеих ОС.
// Новый прыжок нужен только для следующего шага или явного повтора подсказки.
export function resumeCoachAfterDrag(): void {
  const step = current();
  if (!coach.active || coach.advancing || !step) return;
  coach.keepPosition = true;
  sayStep(step);
  if (coach.target) showRing(coach.target);
  startPoll();
}

export function stopCoach(): void {
  coach.active = false;
  coach.run++;
  clearTimeout(coach.advance);
  clearInterval(coach.poll);
}

export function runScenario(sc: Scenario): void {
  closePanels();
  endTrainer();
  if (guide.active) endGuide(false);
  stopCoach();
  Object.assign(coach, {
    advancing: false, fileError: '', locateError: '', misses: 0,
    sc, steps: steps(sc), i: -1, ctx: { contact: String(settings.contact || '').trim() }, active: true,
  });
  // для остального кода кот сейчас занят человеком
  Object.assign(guide, { active: true, kind: 'script', goal: '' });
  if (!settings.locator) say(T('coach.noLocator'), 3500, { guide: true });
  if (sc.id === 'volume') {
    // запоминаем громкость в начале, чтобы потом самому заметить, что стало громче
    void readVolume().then((v) => { if (coach.sc === sc && coach.active) { coach.ctx.vol0 = v; void nextStep(); } });
    return;
  }
  void nextStep();
}

/** Кнопки текущего шага (для клика по коту во время урока). */
export function currentStepActions(): Action[] | null {
  const step = current();
  return coach.active && step ? coachStepActions(step) : null;
}

export function initCoach(): void {
  onGuideEnd(stopCoach);
}
