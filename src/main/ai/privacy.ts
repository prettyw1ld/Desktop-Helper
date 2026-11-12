// Что можно показывать ИИ. Без Electron, чтобы проверять тестами.
// Пароли и окна менеджеров паролей ИИ не видит никогда — и у новичка, и в организации.
import type { Rect } from '../../shared/types';

/** Как смотреть на экран: весь экран, только окно, с которым работает человек, или вообще без снимка. */
export type ShotMode = 'screen' | 'window' | 'off';
export interface Privacy { screenshots: ShotMode; denyApps: string[] }
export const OPEN_PRIVACY: Privacy = { screenshots: 'screen', denyApps: [] };

// Программы, на которые не смотрим никогда: менеджеры паролей, запрос прав администратора (UAC), вход в Windows.
const BUILTIN_DENY = /^(keepass|keepassxc|1password|bitwarden|lastpass|dashlane|nordpass|roboform|enpass|keeper|passwordsafe|consent|credentialuibroker|logonui|lockapp)$/i;

/** Что знает система об окне перед человеком (locator: guard). */
export interface Guard { password?: boolean; proc?: string; title?: string; rect?: Rect | null }

/** Почему сейчас нельзя смотреть на экран: 'password', 'app' или '' (можно). */
export function blockReason(g: Guard, denyApps: string[] = []): 'password' | 'app' | '' {
  if (g.password) return 'password';
  const proc = (g.proc || '').replace(/\.exe$/i, '').toLowerCase();
  if (!proc) return '';
  if (BUILTIN_DENY.test(proc)) return 'app';
  if (denyApps.some((a) => a.replace(/\.exe$/i, '').toLowerCase() === proc)) return 'app';
  return '';
}

/** Раздел privacy из политики организации; что непонятно — то строже. */
export function parsePrivacy(raw: unknown): Privacy {
  if (!raw || typeof raw !== 'object') return { ...OPEN_PRIVACY };
  const o = raw as Record<string, unknown>;
  const mode = o.screenshots;
  const screenshots: ShotMode = mode === undefined || mode === 'screen' ? 'screen' : mode === 'window' ? 'window' : 'off';
  const denyApps = Array.isArray(o.denyApps)
    ? o.denyApps.filter((a): a is string => typeof a === 'string' && !!a.trim()).map((a) => a.trim()).slice(0, 200)
    : [];
  return { screenshots, denyApps };
}

/** Закрасить чёрным всё, кроме keep (картинка BGRA w×h, прямоугольники в её пикселях). */
export function maskOutside(bgra: Buffer, w: number, h: number, keep: Rect[]): Buffer {
  const out = Buffer.from(bgra);
  const boxes = keep.map((r) => ({
    x0: Math.max(0, Math.floor(r.x)), y0: Math.max(0, Math.floor(r.y)),
    x1: Math.min(w, Math.ceil(r.x + r.w)), y1: Math.min(h, Math.ceil(r.y + r.h)),
  })).filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
  for (let y = 0; y < h; y++) {
    const row = boxes.filter((b) => y >= b.y0 && y < b.y1).sort((a, b) => a.x0 - b.x0);
    let x = 0;
    for (const b of [...row, { x0: w, x1: w }]) {
      if (b.x0 > x) out.fill(0, (y * w + x) * 4, (y * w + b.x0) * 4);
      x = Math.max(x, b.x1);
    }
    // альфа-канал оставляем непрозрачным
    for (let i = y * w * 4 + 3; i < (y + 1) * w * 4; i += 4) out[i] = 255;
  }
  return out;
}
