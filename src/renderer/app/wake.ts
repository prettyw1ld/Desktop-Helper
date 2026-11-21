// Позвать кота голосом: «Пушик!» (или имя, которое дал человек). Кот вздрагивает, садится мордой к человеку
// и шевелит ушами, пока слушает. Потом думает «…» и отвечает в облачке над собой, отдельно от чата.
// Если просьба про то, как что-то сделать, ведёт по экрану, как на написанную просьбу. Включается в настройках.
import { setState } from '../cat/cat';
import { showPose } from '../cat/poses';
import { dom } from '../core/dom';
import { T } from '../core/i18n';
import { settings } from '../core/settings';
import { catNameFor } from '../../shared/cat-name';
import { micInUse } from '../core/voice';
import { startEar, type Ear, type EarHooks } from '../core/wake';
import { api } from '../core/api';
import { guide, trainer } from '../guide/state';
import { routeGoal } from '../guide/router';
import { refreshReminders } from '../panels/reminders';
import { isError, type ChatResult, type ErrorReply } from '../../shared/types';
import { hideBubble, say } from '../ui/bubble';
import { closePanels, openPanel } from '../ui/panels';

/** Чем включать уши и как вести по экрану. В тестах подменяется. */
export const ears = { start: startEar };
export const lead = { goal: routeGoal };

let ear: Ear | null = null;
let earName = '';      // на какое имя сейчас откликаемся
let starting = false;
let busy = false;      // слушаем просьбу или ждём ответ на неё
let failed = false;    // микрофон не дали: не пытаемся снова, пока человек не выключит и не включит

const wanted = (): boolean => settings.wakeWord && settings.hasVosk;
const LISTEN_MS = 16000; // поза «слушаю» держится, пока идёт просьба (уши слушают не дольше 15 с)

const speaking = (): boolean => 'speechSynthesis' in window && speechSynthesis.speaking;

// Не откликаемся, когда кот и так занят с человеком: диктуют в кнопку микрофона, кот сам говорит,
// идёт тренировка мышки или показ по шагам.
const canAnswer = (): boolean => !busy && !micInUse() && !speaking() && !trainer.step && !guide.active;

/** Сколько держать ответ в облачке: успеть прочитать не спеша. */
export const readMs = (text: string): number => Math.min(20000, Math.max(5000, 2500 + text.length * 70));

/** Кот садится и думает «…» на месте, никуда не уходя. */
function think(on: boolean): void {
  dom.cat.classList.toggle('thinking', on);
  if (on) setState('busy');
}

async function deliver(text: string): Promise<void> {
  if (!settings.aiReady) {
    hideBubble();
    setState('idle', 3000);
    lead.goal(text); // без ИИ: уроки и показ по экрану, как с кнопки микрофона
    return;
  }
  hideBubble();
  think(true);
  const res: ChatResult | ErrorReply = await api.voiceAsk(text).catch((): ErrorReply => ({ error: T('err.ask') }));
  think(false);
  if (isError(res)) { say(res.error, 6000); setState('idle', 6000); return; }
  if (res.show) {
    // «Как сделать…»: не текст, а показ лапкой по шагам
    say(T('chat.showing', { goal: res.show }), 2500);
    const goal = res.show;
    setTimeout(() => lead.goal(goal), 700);
    return;
  }
  const ms = readMs(res.reply);
  say(res.reply, ms);
  setState('busy', ms); // сидит рядом, пока человек читает, потом снова гуляет
  if (res.actions.length) void refreshReminders();
}

const hooks: EarHooks = {
  onName() {
    if (!canAnswer()) return false;
    busy = true;
    if (openPanel()) closePanels(); // окно рядом с котом закрыло бы облачко
    // вздрогнул «!» и сел мордой к человеку, шевелит ушами: слушает
    showPose('surpriseF', 700);
    setTimeout(() => { if (busy) showPose('earTwitchF', LISTEN_MS); }, 700);
    say(T('wake.yes'), Infinity);
    return true;
  },
  onPartial(text) {
    if (busy) say(`${text}…`, Infinity);
  },
  onPhrase(text) {
    if (!text) {
      busy = false;
      setState('idle', 2000);
      say(T('wake.nothing'), 4000);
      return;
    }
    void deliver(text).catch(() => { think(false); }).finally(() => { busy = false; });
  },
  onLost() {
    stopWake();
    failed = true;
    say(T('wake.noMic'), 6000);
  },
};

const currentName = (): string => catNameFor(settings.catName, settings.lang);

async function startWake(): Promise<void> {
  starting = true;
  const name = currentName();
  try {
    const words = await api.nameWords(name);
    if (!words.length) {
      // имя, которое модель не расслышит (ни его, ни похожих слов): честно говорим и не включаем микрофон
      failed = true;
      say(T('wake.hardName'), 8000);
      return;
    }
    await api.askMic();
    ear = await ears.start(hooks, name, words);
    earName = name;
  } catch {
    ear = null;
    failed = true;
    say(T('wake.noMic'), 6000);
  } finally {
    starting = false;
  }
  if (ear && (!wanted() || earName !== currentName())) { stopWake(); syncWake(); } // пока включались, настройки поменяли
}

function stopWake(): void {
  ear?.stop();
  ear = null;
  if (busy) { hideBubble(); think(false); setState('idle', 2000); } // «Слушаю тебя» больше не правда
  busy = false;
}

let failedName = '';

/** Включить или выключить уши по настройкам. Зовётся при каждом применении настроек. */
export function syncWake(): void {
  // кота переименовали: слушаем новое имя
  if (ear && earName !== currentName()) stopWake();
  if (!settings.wakeWord || failedName !== currentName()) failed = false;
  failedName = currentName();
  if (wanted() && !ear && !starting && !failed) void startWake();
  else if (!wanted() && ear) stopWake();
}

/** Слушает ли кот сейчас своё имя (для тестов и отладки). */
export const listening = (): boolean => !!ear;
