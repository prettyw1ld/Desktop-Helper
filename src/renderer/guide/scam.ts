// Защита от мошенников без ИИ: запустилась программа удалённого доступа (AnyDesk, TeamViewer…).
// Кот не пугает, а спокойно спрашивает. «Это свои» — больше не спрашиваем про эту программу.
import type { TunnelNotice } from '../../shared/types';
import { surprised } from '../cat/poses';
import { leaveTrash } from '../cat/trash';
import { api } from '../core/api';
import { T } from '../core/i18n';
import { setSettings, settings } from '../core/settings';
import { Sound } from '../core/sound';
import { hideBubble, say } from '../ui/bubble';
import { speak } from '../ui/speech';
import { endGuide } from './control';
import { guide } from './state';

// Пока кот говорит о мошенниках, случайные фразы не перебивают его.
function done(): void {
  guide.active = false;
  hideBubble();
}

function warnStop(app: string): void {
  const text = T('scam.stop', { app });
  const tip = T('scam.stopTip', { app });
  say(text, Infinity, { guide: true, danger: true, explain: tip, actions: [[T('g.ok'), done, true]] });
  speak(`${text} ${tip}`);
}

async function trust(app: string): Promise<void> {
  done();
  const list = [...new Set([...(settings.trustedRemote || []), app])];
  setSettings(await api.saveSettings({ trustedRemote: list }));
  say(T('scam.trusted', { app }), 5000);
}

export function remoteAppStarted(app: string): void {
  leaveTrash();
  if (guide.active) endGuide(false);
  guide.active = true;
  Sound.bell();
  const text = T('scam.ask', { app });
  surprised(() => {});
  say(text, Infinity, {
    guide: true, danger: true,
    actions: [[T('scam.yes'), () => warnStop(app), true], [T('scam.no'), () => { void trust(app); }]],
  });
  speak(text);
}

/** Открыт туннель наружу (cloudflared, ngrok…). Кот говорит, что закрыл его или что так нельзя, и кто его запустил. */
export function tunnelOpened(t: TunnelNotice): void {
  leaveTrash();
  if (guide.active) endGuide(false);
  guide.active = true;
  Sound.bell();
  surprised(() => {});
  const key = t.result === 'stopped' ? 'tunnel.stopped' : t.result === 'stop_failed' ? 'tunnel.failed' : 'tunnel.warn';
  const text = [T(key, { app: t.app }), t.by ? T('tunnel.by', { by: t.by }) : ''].filter(Boolean).join(' ');
  say(text, Infinity, { guide: true, danger: true, explain: T('tunnel.tip'), actions: [[T('g.ok'), done, true]] });
  speak(text);
}

export function initScamGuard(): void {
  api.on('remote-app', remoteAppStarted);
  api.on('tunnel', tunnelOpened);
}
