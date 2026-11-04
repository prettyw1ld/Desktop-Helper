// Мышь: клики сквозь окно, перенос кота за шкирку, клики, двойные клики и поглаживание кота.
import { cat, CAT_H, CAT_W, floorY, setState, size, startFall, SCRUFF_Y } from '../cat/cat';
import { pet, petMore, happy, showPose } from '../cat/poses';
import { api } from '../core/api';
import { dom } from '../core/dom';
import { T } from '../core/i18n';
import { Sound } from '../core/sound';
import { clamp, now } from '../core/util';
import { aiStepActions, repeatAiStep } from '../guide/ai-guide';
import { currentStepActions, resumeCoachAfterDrag } from '../guide/coach';
import { endGuide } from '../guide/control';
import { cancelPointGaze } from '../guide/pointing';
import { guide, trainer } from '../guide/state';
import { endTrainer, trainerSay } from '../guide/trainer';
import { hideBubble, placeBubble, say } from '../ui/bubble';
import { closePanels, openPanel, showPanel } from '../ui/panels';
import { strokes } from './stroke';

// Окно кота пропускает клики насквозь везде, кроме кота и панелей (у них класс .hit).
let ignoring = true;
export function setIgnore(v: boolean): void {
  if (v === ignoring) return;
  ignoring = v;
  api.setIgnoreMouse(v);
}

interface Press { x: number; y: number; catX: number; catY: number; moved: boolean }
let press: Press | null = null;

// Кота взяли: он повисает так, чтобы курсор был у него на загривке.
function pickUp(p: Press): void {
  p.moved = true;
  cancelPointGaze();
  p.catX = p.x - CAT_W / 2;
  p.catY = p.y - (CAT_H - (CAT_H - SCRUFF_Y) * size());
  // окна и подсказки прячем, чтобы не мешали (подсказку урока оставляем)
  if (!trainer.step) { closePanels(); if (!guide.active) hideBubble(); }
  cat.plat = null;
  cat.climb = null;
  cat.jump = null;
  setState('drag');
}

function onMove(e: MouseEvent): void {
  if (press) {
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.hypot(dx, dy) > 5) pickUp(press);
    if (press.moved) {
      cat.x = press.catX + dx;
      cat.y = press.catY + dy;
    }
    return;
  }
  const target = document.elementFromPoint(e.clientX, e.clientY);
  setIgnore(!target?.closest('.hit'));
  onStroke(e.clientX, e.clientY, !!target?.closest('.hitbox'));
}

// Водят мышкой по коту, не нажимая: гладят. Не во время урока и подсказки и не в полёте.
const NO_PET = ['drag', 'fall', 'jump', 'intro', 'outro', 'perch'];
function onStroke(x: number, y: number, over: boolean): void {
  if (guide.active || trainer.step || NO_PET.includes(cat.state)) { strokes.reset(); return; }
  const ev = strokes.feed(x, y, now(), over, size());
  if (ev === 'pet') pet(true);
  // гладят дальше: продолжаем, только если кот всё ещё жмурится, а не занят чем-то новым
  else if (ev === 'more' && cat.state === 'act' && cat.act === 'heartsSitF') petMore();
}

// Кота отпустили.
function drop(): void {
  if (trainer.step === 'drag' || trainer.step === 'landing') { trainer.step = 'landing'; hideBubble(); startFall(); return; }
  if (guide.active) {
    // Перенос не завершает подсказку: perch удерживает кота, а текущий шаг сохраняется.
    // Одинаковое поведение на Mac и Windows; падение здесь снова спрятало бы подсказку.
    cat.jump = null;
    cat.plat = null;
    cat.vy = 0;
    cat.y = clamp(cat.y, 0, Math.max(0, floorY()));
    setState('perch');
    if (guide.kind === 'script') resumeCoachAfterDrag();
    else repeatAiStep();
    placeBubble();
    return;
  }
  startFall();
}

// много быстрых тыков подряд злят кота
let clicks: number[] = [];

function onCatClick(): void {
  if (trainer.step === 'click') {
    happy(800);
    trainer.step = 'dbl';
    setTimeout(() => { if (trainer.step === 'dbl') trainerSay('tr.dbl'); }, 300);
    return;
  }
  if (trainer.step === 'dbl') return; // ждём двойной клик
  if (trainer.step === 'drag') { say(T('tr.oops'), 2500); return; }
  clicks = clicks.filter((c) => now() - c < 3000);
  clicks.push(now());
  if (clicks.length >= 6) {
    clicks = [];
    closePanels();
    showPose('angry', 2500, T('say.angry'));
    Sound.hiss();
    return;
  }
  // во время подсказки клик по коту ничего не ломает, но всегда даёт выход: повторить или закончить
  if (guide.active) {
    if (guide.busy) return;
    const acts = (guide.kind === 'ai' && guide.last ? aiStepActions() : null)
      ?? (guide.kind === 'script' ? currentStepActions() : null)
      ?? [[T('g.stop'), () => endGuide(true), true]];
    say(guide.last?.say || T('g.stopAsk'), Infinity, { actions: acts, guide: true });
    return;
  }
  if (cat.state === 'sleep') {
    setState('idle', 4000);
    say(T('say.notSleeping'), 2000);
  }
  if (cat.state === 'walk') { cat.climb = null; setState('idle', 6000); }
  hideBubble();
  Sound.meow();
  if (openPanel() === 'help') closePanels();
  else showPanel('help');
}

export function initMouse(): void {
  document.addEventListener('mousemove', onMove);
  dom.cat.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.bubble')) return;
    e.preventDefault();
    press = { x: e.clientX, y: e.clientY, catX: cat.x, catY: cat.y, moved: false };
  });
  document.addEventListener('mouseup', () => {
    if (!press) return;
    const wasDrag = press.moved;
    press = null;
    if (wasDrag) drop(); else onCatClick();
  });
  dom.cat.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('.bubble') || guide.active) return;
    if (trainer.step === 'dbl') {
      pet();
      trainer.step = 'drag';
      setTimeout(() => { if (trainer.step === 'drag') trainerSay('tr.drag'); }, 1600);
      return;
    }
    if (trainer.step) return;
    pet();
  });
  // Esc: закрыть панель, иначе закончить подсказку или тренажёр
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openPanel()) closePanels();
    else if (guide.active) endGuide(true);
    else if (trainer.step) endTrainer(true);
  });
}
