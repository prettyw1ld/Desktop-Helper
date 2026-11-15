// Настройки с сервера организации (E-36/E-37). Без Electron: логику проверяют тесты.
//
// Админ подписывает набор настроек своим ключом Ed25519 (server/tools/config-sign.mjs), сервер только
// хранит и раздаёт подписанное. Пушик принимает набор, если:
//   - подпись сходится с открытым ключом из политики (presence.configKey): сервер подделать не может;
//   - набор адресован ему: всем (global), его подразделению (group:<имя>) или ему самому (device:<id>);
//   - версия не ниже уже принятой для этого адресата: старый набор не вернуть.
// Набор может только ужесточить политику из реестра или policy.json, но не ослабить её.
import crypto from 'node:crypto';
import type { Features } from '../shared/types';
import type { AnswerRules } from './ai/answer-guard';
import type { Privacy, ShotMode } from './ai/privacy';

export interface Bundle { payload: string; sig: string }

export interface Overlay {
  features?: Partial<Record<keyof Features, false>>;
  privacy?: { screenshots?: ShotMode; denyApps?: string[]; masks?: string[] };
  answers?: { allowHosts?: string[] };
}

export interface Payload { v: 1; scope: string; version: number; issuedAt: number; settings: Overlay }

/** Что можно ужесточить с сервера. */
export interface Tunable { features: Features; privacy: Privacy; answers: AnswerRules }

// DER-заголовок открытого ключа Ed25519 (SPKI): к нему дописываются 32 байта самого ключа
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** Ключ из политики: 32 байта в base64 или PEM. Пустой или неверный — null (настройки с сервера не принимаем). */
export function publicKey(raw: string): crypto.KeyObject | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    if (s.includes('BEGIN PUBLIC KEY')) {
      const k = crypto.createPublicKey(s);
      return k.asymmetricKeyType === 'ed25519' ? k : null;
    }
    const bytes = Buffer.from(s, 'base64');
    if (bytes.length !== 32) return null;
    return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, bytes]), format: 'der', type: 'spki' });
  } catch { return null; }
}

const MODES: ShotMode[] = ['screen', 'window', 'off'];
const list = (v: unknown, max: number, len: number): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim() && x.length <= len).map((x) => x.trim()).slice(0, max) : undefined;

/** Разбор настроек набора: всё незнакомое отбрасываем. */
export function parseOverlay(raw: unknown): Overlay {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: Overlay = {};
  const f = o.features && typeof o.features === 'object' ? o.features as Record<string, unknown> : null;
  if (f) {
    const off: Overlay['features'] = {};
    for (const k of ['chat', 'guide', 'inspect'] as const) if (f[k] === false) off[k] = false;
    if (Object.keys(off).length) out.features = off;
  }
  const p = o.privacy && typeof o.privacy === 'object' ? o.privacy as Record<string, unknown> : null;
  if (p) {
    const priv: NonNullable<Overlay['privacy']> = {};
    if (p.screenshots === 'window' || p.screenshots === 'off') priv.screenshots = p.screenshots;
    const deny = list(p.denyApps, 200, 100);
    if (deny?.length) priv.denyApps = deny;
    const masks = list(p.masks, 50, 200);
    if (masks?.length) priv.masks = masks;
    if (Object.keys(priv).length) out.privacy = priv;
  }
  const a = o.answers && typeof o.answers === 'object' ? o.answers as Record<string, unknown> : null;
  const hosts = a ? list(a.allowHosts, 100, 253) : undefined;
  if (hosts) out.answers = { allowHosts: hosts.map((h) => h.toLowerCase().replace(/^\*\./, '')).filter((h) => /^[a-z0-9.-]+$/.test(h) && h.includes('.')) };
  return out;
}

/** Проверка набора. Возвращает разобранное содержимое или причину отказа. */
export function verify(b: Bundle, key: crypto.KeyObject | null): Payload | { error: string } {
  if (!key) return { error: 'no key' };
  if (typeof b?.payload !== 'string' || typeof b?.sig !== 'string' || b.payload.length > 64 * 1024) return { error: 'shape' };
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(b.payload, 'utf8'), key, Buffer.from(b.sig, 'base64')); } catch { ok = false; }
  if (!ok) return { error: 'signature' };
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(b.payload) as Record<string, unknown>; } catch { return { error: 'json' }; }
  const version = raw.version;
  if (raw.v !== 1 || typeof raw.scope !== 'string' || !Number.isSafeInteger(version) || (version as number) < 1) return { error: 'shape' };
  return {
    v: 1, scope: raw.scope, version: version as number,
    issuedAt: Number.isFinite(raw.issuedAt) ? raw.issuedAt as number : 0,
    settings: parseOverlay(raw.settings),
  };
}

/** Адресаты, которым этот Пушик подчиняется, в порядке применения: общее → подразделение → сам. */
export function scopesFor(group: string, deviceId: string): string[] {
  return ['global', ...(group ? [`group:${group}`] : []), ...(deviceId ? [`device:${deviceId}`] : [])];
}

export interface Accepted { payloads: Payload[]; bundles: Bundle[]; seen: Record<string, number>; rejected: { scope: string; error: string }[] }

/**
 * Какие наборы применить. seen — версии, уже принятые раньше (хранятся на диске): более старый набор
 * отклоняется, даже если подпись верна, — так нельзя «откатить» Пушика на ослабленные настройки.
 */
export function accept(bundles: Bundle[], key: crypto.KeyObject | null, scopes: string[], seen: Record<string, number>): Accepted {
  const best = new Map<string, { p: Payload; b: Bundle }>();
  const rejected: Accepted['rejected'] = [];
  for (const b of bundles.slice(0, 20)) {
    const p = verify(b, key);
    if ('error' in p) { rejected.push({ scope: '', error: p.error }); continue; }
    if (!scopes.includes(p.scope)) { rejected.push({ scope: p.scope, error: 'not for me' }); continue; }
    if (p.version < (seen[p.scope] ?? 0)) { rejected.push({ scope: p.scope, error: 'rollback' }); continue; }
    const cur = best.get(p.scope);
    if (!cur || p.version > cur.p.version) best.set(p.scope, { p, b });
  }
  const kept = scopes.map((s) => best.get(s)).filter((x): x is { p: Payload; b: Bundle } => !!x);
  const next = { ...seen };
  for (const { p } of kept) next[p.scope] = p.version;
  return { payloads: kept.map((x) => x.p), bundles: kept.map((x) => x.b), seen: next, rejected };
}

const stricter = (a: ShotMode, b: ShotMode | undefined): ShotMode => (b && MODES.indexOf(b) > MODES.indexOf(a) ? b : a);
const union = (a: string[], b: string[] | undefined): string[] => (b ? [...new Set([...a, ...b])] : a);

/** Наложить наборы на политику: выключить можно, включить нельзя; запретов только больше. */
export function tighten(base: Tunable, payloads: Payload[]): Tunable {
  let t: Tunable = { features: { ...base.features }, privacy: { ...base.privacy }, answers: { ...base.answers } };
  for (const { settings: o } of payloads) {
    const features = { ...t.features };
    for (const k of Object.keys(o.features ?? {}) as (keyof Features)[]) features[k] = false;
    const privacy: Privacy = {
      screenshots: stricter(t.privacy.screenshots, o.privacy?.screenshots),
      denyApps: union(t.privacy.denyApps, o.privacy?.denyApps),
      masks: union(t.privacy.masks, o.privacy?.masks),
    };
    // ссылки: если политика открыта, сервер может ввести список; если список уже есть — только сузить
    const want = o.answers?.allowHosts;
    const have = t.answers.allowHosts;
    const allowHosts = !want ? have : have === null ? want : have.filter((h) => want.includes(h));
    t = { features, privacy, answers: { allowHosts } };
  }
  return t;
}
