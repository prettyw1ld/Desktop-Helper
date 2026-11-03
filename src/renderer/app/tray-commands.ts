// Команды из меню в трее: позвать кота, открыть панель, спрятать и показать.
import { cat, floorY, landThen, setState, startFall, W, walkTo } from '../cat/cat';
import { api } from '../core/api';
import { T } from '../core/i18n';
import { endGuide } from '../guide/control';
import { guide } from '../guide/state';
import { startTrainer } from '../guide/trainer';
import { say } from '../ui/bubble';
import { closePanels, isPanel, showPanel } from '../ui/panels';

function call(): void {
  closePanels();
  landThen(() => { walkTo(W() / 2, true); say(T('say.coming'), 2000); });
}

// уходит вглубь экрана и прячется
function hide(): void {
  closePanels();
  if (guide.active) endGuide(false);
  const outro = () => { setState('outro'); cat.onDone = () => api.hide(); };
  if (cat.y < floorY() - 2 && !cat.plat) { cat.afterLand = outro; startFall(); } else outro();
}

// выбегает из глубины экрана
function show(): void {
  cat.introRun = true;
  cat.y = floorY();
  cat.plat = null;
  setState('intro');
}

export function initTrayCommands(): void {
  api.on('open', (what) => {
    if (what === 'call') call();
    else if (what === 'trainer') startTrainer();
    else if (what === 'hide') hide();
    else if (what === 'show') show();
    else if (isPanel(what)) {
      if (what === 'help' && cat.state === 'sleep') setState('idle', 4000);
      showPanel(what);
    }
  });
}
