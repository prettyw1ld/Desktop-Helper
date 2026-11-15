// Фоновые наблюдатели: календарь, окна других программ и программы удалённого доступа.
import { screen } from 'electron';
import { T } from '../shared/i18n';
import type { CalendarList } from '../shared/types';
import * as calendar from './system/calendar';
import * as audit from './audit';
import * as remoteWatch from './system/remote-watch';
import * as tunnels from './system/tunnels';
import * as windowsWatch from './system/windows';
import * as settings from './settings';
import * as ui from './ui';

// ---------- Календарь ----------
export function startCalendar(): void {
  const s = settings.get();
  calendar.start({
    url: s.calendarUrl,
    before: Number(s.calendarBefore) || 10,
    onSoon: (e, min) => {
      const text = min > 0 ? T('cal.soon', { min, title: e.title }) : T('cal.now', { title: e.title });
      ui.notify(T('notif.calendar'), text);
      ui.showInactive();
      ui.send('calendar-soon', { ...e, min, text });
    },
  }).then(() => ui.send('calendar-changed'));
}

export function calendarList(days: number): CalendarList {
  return { ...calendar.status(), events: calendar.upcoming(days) };
}

export const refreshCalendar = (): Promise<void> => calendar.refresh();

// ---------- Окна других программ ----------
export function startWindowsWatch(): void {
  windowsWatch.stop();
  ui.send('windows', []);
  if (!settings.get().windows) return;
  const toDip = (r: Electron.Rectangle) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r);
  windowsWatch.start((list) => {
    // переводим в координаты нашего окна (оно занимает весь основной экран)
    const wa = screen.getPrimaryDisplay().bounds;
    ui.send('windows', list.map(([id, x, y, w, h]) => [id, x - wa.x, y - wa.y, w, h]));
  }, toDip);
}

// ---------- Программы удалённого доступа ----------
export function startRemoteWatch(): void {
  remoteWatch.start((name) => {
    if ((settings.get().trustedRemote || []).includes(name)) return;
    ui.send('remote-app', name);
  });
}

// ---------- Туннели во внешние сервисы (корпоративный режим) ----------
// cloudflared, ngrok, ssh -R и т.п. открывают компьютер в интернет. Их часто без спроса запускают ИИ-агенты.
// Политика решает: только предупредить (warn) или ещё и закрыть (stop). Каждый случай — в журнал и SIEM.
const lastTunnelWarn = new Map<string, number>();

function onTunnel(t: tunnels.Tunnel, action: tunnels.TunnelAction): void {
  let result: 'warned' | 'stopped' | 'stop_failed' = 'warned';
  if (action === 'stop') {
    try { process.kill(t.pid); result = 'stopped'; } catch { result = 'stop_failed'; }
  }
  const by = t.chain.filter((n) => !/^(cmd|bash|sh|zsh|pwsh|powershell|conhost|wsl|node|npx|npm|explorer|windowsterminal|openconsole)$/.test(n))[0] || t.chain[0] || '';
  audit.event('tunnel', { app: t.app, act: result, pid: t.pid, by: t.chain.join(' < '), cmd: t.cmd }, result === 'warned' ? 7 : 8);
  // один и тот же туннель агент может перезапускать раз за разом: кот говорит не чаще раза в 30 с
  const now = Date.now();
  if (now - (lastTunnelWarn.get(t.app) ?? 0) < 30_000) return;
  lastTunnelWarn.set(t.app, now);
  const key = result === 'stopped' ? 'tunnel.stopped' : result === 'stop_failed' ? 'tunnel.failed' : 'tunnel.warn';
  ui.notify(T('notif.tunnel'), T(key, { app: t.app }));
  ui.showInactive();
  ui.send('tunnel', { app: t.app, by, result });
}

export function startTunnelWatch(): void {
  const rules = settings.tunnels();
  tunnels.start(rules, (t) => onTunnel(t, rules.action));
}

export function stopAll(): void {
  windowsWatch.stop();
  remoteWatch.stop();
  tunnels.stop();
}
