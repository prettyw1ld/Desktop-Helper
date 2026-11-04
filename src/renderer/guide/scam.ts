// Защита от мошенников без ИИ: запустилась программа удалённого доступа (AnyDesk, TeamViewer…).
// Кот не пугает, а спокойно спрашивает. «Это свои» — больше не спрашиваем про эту программу.
import { surprised } from '../cat/poses';
import { api } from '../core/api';
import { T } from '../core/i18n';
import { setSettings, settings } from '../core/settings';
import { Sound } from '../core/sound';
import { hideBubble, say } from '../ui/bubble';
import { speak } from '../ui/speech';
import { endGuide } from './control';
import { guide } from './state';

function warnStop(app: string): void {
  const text = T('scam.stop', { app });
  const tip = T('scam.stopTip', { app });
  say(text, Infinity, { guide: true, danger: true, explain: tip, actions: [[T('g.ok'), hideBubble, true]] });
  speak(`${text} ${tip}`);
}

async function trust(app: string): Promise<void> {
  hideBubble();
  const list = [...new Set([...(settings.trustedRemote || []), app])];
  setSettings(await api.saveSettings({ trustedRemote: list }));
  say(T('scam.trusted', { app }), 5000);
}

export function remoteAppStarted(app: string): void {
  if (guide.active) endGuide(false);
  Sound.bell();
  const text = T('scam.ask', { app });
  surprised(() => {});
  say(text, Infinity, {
    guide: true, danger: true,
    actions: [[T('scam.yes'), () => warnStop(app), true], [T('scam.no'), () => { void trust(app); }]],
  });
  speak(text);
}

export function initScamGuard(): void {
  api.on('remote-app', remoteAppStarted);
}
