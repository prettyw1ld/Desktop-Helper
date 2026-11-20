// Позвать кота голосом: «Пушик!» — кот откликается, слушает просьбу и отвечает в чате
// (или ведёт по экрану, как на написанную просьбу). Включается в настройках.
// Пока уши включены, над котом виден значок микрофона: человек всегда видит, что его слушают.
import { $ } from '../core/dom';
import { T } from '../core/i18n';
import { settings } from '../core/settings';
import { micInUse } from '../core/voice';
import { startEar, type Ear, type EarHooks } from '../core/wake';
import { api } from '../core/api';
import { guide, trainer } from '../guide/state';
import { routeGoal } from '../guide/router';
import { askCat } from '../panels/chat';
import { hideBubble, say } from '../ui/bubble';
import { icon } from '../ui/icons';
import { showPanel } from '../ui/panels';

/** Чем включать уши. В тестах подменяется. */
export const ears = { start: startEar };

let ear: Ear | null = null;
let starting = false;
let busy = false;      // слушаем просьбу или ждём ответ на неё
let failed = false;    // микрофон не дали: не пытаемся снова, пока человек не выключит и не включит

const badge = () => $('#ear');
const wanted = (): boolean => settings.wakeWord && settings.hasVosk;

function showBadge(): void {
  const b = badge();
  if (!b.firstChild) b.innerHTML = icon('mic');
  b.classList.toggle('hidden', !ear);
  b.classList.toggle('hearing', busy);
  b.title = T('wake.badge');
  b.setAttribute('aria-label', T('wake.badge'));
}

const speaking = (): boolean => 'speechSynthesis' in window && speechSynthesis.speaking;

// Не откликаемся, когда кот и так занят с человеком: диктуют в кнопку микрофона, кот сам говорит,
// идёт тренировка мышки или показ по шагам.
const canAnswer = (): boolean => !busy && !micInUse() && !speaking() && !trainer.step && !guide.active;

async function deliver(text: string): Promise<void> {
  hideBubble();
  if (settings.aiReady) {
    showPanel('chat');
    await askCat(text);
  } else {
    routeGoal(text); // без ИИ: уроки и показ по экрану, как с кнопки микрофона
  }
}

const hooks: EarHooks = {
  onName() {
    if (!canAnswer()) return false;
    busy = true;
    showBadge();
    say(T('wake.yes'), Infinity);
    return true;
  },
  onPartial(text) {
    if (busy) say(`${text}…`, Infinity);
  },
  onPhrase(text) {
    if (!text) {
      busy = false;
      showBadge();
      say(T('wake.nothing'), 4000);
      return;
    }
    void deliver(text).catch(() => { /* ответ не пришёл: чат сам покажет ошибку */ }).finally(() => { busy = false; showBadge(); });
    showBadge();
  },
  onLost() {
    stopWake();
    failed = true;
    say(T('wake.noMic'), 6000);
  },
};

async function startWake(): Promise<void> {
  starting = true;
  try {
    await api.askMic();
    ear = await ears.start(hooks);
  } catch {
    ear = null;
    failed = true;
    say(T('wake.noMic'), 6000);
  } finally {
    starting = false;
  }
  if (!wanted()) stopWake(); // пока включались, уши выключили в настройках
  showBadge();
}

function stopWake(): void {
  ear?.stop();
  ear = null;
  if (busy) hideBubble(); // «Слушаю тебя» больше не правда
  busy = false;
  showBadge();
}

/** Включить или выключить уши по настройкам. Зовётся при каждом применении настроек. */
export function syncWake(): void {
  if (!settings.wakeWord) failed = false;
  if (wanted() && !ear && !starting && !failed) void startWake();
  else if (!wanted() && ear) stopWake();
  else showBadge();
}
