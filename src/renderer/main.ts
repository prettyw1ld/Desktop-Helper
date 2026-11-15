/* Пушик: кот-помощник для тех, кто только знакомится с компьютером.
   Кот живёт на рабочем столе, смотрит на экран по просьбе человека и показывает лапкой, куда нажать.
   Здесь только запуск: каждая часть подключает свои обработчики в init*(). */
import { greeting, resetBreakTimer, scheduleChatter } from './app/care';
import { initTrayCommands } from './app/tray-commands';
import { startLoop } from './cat/behaviour';
import { cat, floorY, setState, setWorkArea, W } from './cat/cat';
import { initCursorWatch } from './cat/cursor-watch';
import { initTrash } from './cat/trash';
import { refreshPlatforms, setWindows } from './cat/platforms';
import { api } from './core/api';
import { T } from './core/i18n';
import { setSettings, settings } from './core/settings';
import { initAiGuide } from './guide/ai-guide';
import { initCoach, startTourOnce } from './guide/coach';
import { initInspect } from './guide/inspect';
import { initScamGuard } from './guide/scam';
import { afterFirstTraining, initTrainer, startTrainer } from './guide/trainer';
import { initMouse } from './input/mouse';
import { addMsg, initChat } from './panels/chat';
import { initHelp } from './panels/help';
import { initLessons } from './panels/lessons';
import { initReport } from './panels/report';
import { initReminders } from './panels/reminders';
import { applySettings, initSettings } from './panels/settings';
import { initBubble, say } from './ui/bubble';
import { initIcons } from './ui/icons';
import { initFocus } from './ui/focus';
import { initPanels } from './ui/panels';
import { initYarn } from './ui/ring';

async function start(): Promise<void> {
  initIcons();
  initBubble();
  initYarn();
  initTrash();
  initPanels();
  initFocus();
  initHelp();
  initChat();
  initSettings();
  initLessons();
  initReport();
  initCoach();
  initTrainer();
  initAiGuide();
  initInspect();
  initScamGuard();
  initMouse();
  initCursorWatch();
  initTrayCommands();
  afterFirstTraining(startTourOnce);
  api.on('windows', (list) => setWindows(list));
  api.on('work-area', (r) => setWorkArea(r));
  window.addEventListener('resize', () => { cat.y = Math.min(cat.y, floorY()); refreshPlatforms(); });

  setSettings(await api.getSettings());
  applySettings();
  addMsg('from-cat', T('chat.hello'));
  await initReminders();

  // кот выходит из глубины экрана к человеку
  cat.x = W() * 0.7;
  cat.y = floorY();
  setState('intro');
  cat.onDone = () => {
    if (!settings.onboarded) startTrainer();
    else say(greeting(), 4500);
  };
  resetBreakTimer();
  scheduleChatter();
  startLoop();
}

void start();
