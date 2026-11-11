// «Объясни, что это»: человек обводит мышкой кнопку или строку, кот объясняет, что это такое.
// Пока человек обводит, окно кота ловит мышь, чтобы клик не ушёл в программу под ним.
import { isError, type LookResult, type Rect } from '../../shared/types';
import { cat, setState, startFall } from '../cat/cat';
import { api } from '../core/api';
import { $, dom, el } from '../core/dom';
import { setIgnore } from '../input/mouse';
import { hideBubble, say, type Action } from '../ui/bubble';
import { closePanels, showPanel } from '../ui/panels';
import { hideRing, showRing } from '../ui/ring';
import { speak, stopSpeaking } from '../ui/speech';
import { startGuide } from './ai-guide';
import { endGuide } from './control';
import { cancelPointGaze, goPoint, guideMasks } from './pointing';
import { guide } from './state';
import { endTrainer } from './trainer';

let picker: HTMLElement | null = null;
let rect: Rect | null = null;
let epoch = 0;        // номер объяснения: ответы от старых отбрасываем
let active = false;

function removePicker(): void {
  picker?.remove();
  picker = null;
  setIgnore(true);
}

export function stopInspect(): void {
  cancelPointGaze();
  dom.bubble.classList.remove('inspect-explanation');
  epoch++;
  active = false;
  removePicker();
  api.guideUnwatch();
  dom.ring.classList.remove('inspect-highlight');
  hideRing();
  hideBubble();
  dom.cat.classList.remove('thinking');
  cat.onArrive = null;
  if (cat.jump) cat.jump.after = null;
  guide.active = false;
  if (cat.state === 'perch') startFall();
  else if (cat.state === 'busy') setState('idle', 3000);
  stopSpeaking();
}

function choose(): void {
  stopInspect();
  rect = null;
  closePanels();
  endTrainer();
  endGuide(false);
  Object.assign(guide, { active: true, kind: 'inspect' });
  setState('busy');
  active = true;
  const p = el('div', 'inspect-picker hit');
  p.innerHTML = '<div class="inspect-tip" role="status">Обведи мышкой строку или кнопку. Esc — отмена.</div><div class="inspect-box hidden"></div>';
  document.body.append(p);
  picker = p;
  setIgnore(false);
  const box = p.querySelector<HTMLElement>('.inspect-box')!;
  let origin: { x: number; y: number } | null = null;
  p.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    origin = { x: e.clientX, y: e.clientY };
    p.setPointerCapture(e.pointerId);
  });
  p.addEventListener('pointermove', (e) => {
    if (!origin) return;
    rect = { x: Math.min(origin.x, e.clientX), y: Math.min(origin.y, e.clientY), w: Math.abs(e.clientX - origin.x), h: Math.abs(e.clientY - origin.y) };
    box.classList.remove('hidden');
    Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  });
  p.addEventListener('pointerup', () => {
    if (!origin) return;
    if (!rect || rect.w < 8 || rect.h < 8) { origin = null; rect = null; return; }
    removePicker();
    void explain();
  });
}

async function explain(): Promise<void> {
  const area = rect;
  if (!area) return;
  const token = ++epoch;
  active = true;
  Object.assign(guide, { active: true, kind: 'inspect' });
  hideRing();
  dom.cat.classList.add('thinking');
  say('Смотрю на выбранную область…', Infinity, { guide: true, actions: [['Отмена', stopInspect]] });
  let result: LookResult | { error: string };
  try {
    result = await api.guideLook({ mode: 'inspect', selection: { ...area }, history: [], goal: '' });
  } catch {
    result = { error: 'Не удалось посмотреть экран. Попробуй ещё раз.' };
  }
  if (token !== epoch || !active) return;
  dom.cat.classList.remove('thinking');
  if (isError(result)) {
    say(result.error, Infinity, { guide: true, actions: [['Повторить', () => { void explain(); }], ['Выбрать другое', choose], ['Закрыть', stopInspect]] });
    return;
  }
  const res = result;
  dom.ring.classList.add('inspect-highlight');
  showRing(area);
  goPoint(area, () => { if (token === epoch && active) showExplanation(res, token); });
}

// Короткое объяснение и кнопки: «Понятно», «Подробнее» (если есть что добавить) и «Покажи, как» (если есть безопасное упражнение).
// Повторить вслух — значок динамика рядом с текстом.
function showExplanation(result: LookResult, token: number): void {
  const text = [result.say, result.explain].filter(Boolean).join(' ')
    || 'Не могу уверенно определить этот элемент. Выдели область точнее.';
  const practice = () => {
    const goal = result.practiceGoal;
    if (!goal) return;
    stopInspect();
    startGuide(goal, 'practice');
  };
  const details = result.details?.trim() ?? '';
  // «Подробнее»: тот же пузырь, но с подробным текстом (как пользоваться, как отменить)
  const show = (body: string, more: boolean) => {
    const actions: Action[] = [['Понятно', stopInspect, true]];
    if (more) actions.push(['Подробнее', () => { if (token === epoch && active) show(`${text}\n\n${details}`, false); }]);
    if (result.practiceGoal && result.status !== 'danger') actions.push(['Покажи, как', practice]);
    dom.bubble.classList.add('inspect-explanation');
    say(body, Infinity, { guide: true, actions, danger: result.status === 'danger' });
    const spoken = more ? text : details;
    const replay = el('button', 'replay', '🔊');
    replay.title = 'Сказать ещё раз';
    replay.setAttribute('aria-label', 'Сказать ещё раз');
    replay.addEventListener('click', (e) => { e.stopPropagation(); if (token === epoch && active) speak(spoken); });
    dom.bubbleText.append(replay);
    speak(spoken);
  };
  show(text, !!details);
  api.guideWatch(guideMasks());
}

export function initInspect(): void {
  api.on('screen-changed', () => {
    if (!active || picker) return;
    stopInspect();
    say('Экран изменился. Выдели элемент ещё раз.', 6000, { guide: true, actions: [['Выбрать элемент', choose]] });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && active) { stopInspect(); e.preventDefault(); } });
  // Кота унесли: объяснение заканчивается, старая рамка убирается.
  document.addEventListener('mousemove', () => { if (active && !picker && cat.state === 'drag') stopInspect(); });
  window.addEventListener('resize', () => { if (active) stopInspect(); });
  $('#inspect-element').addEventListener('click', () => {
    if ($('#inspect-element').dataset.mode === 'lessons') showPanel('lessons');
    else choose();
  });
}
