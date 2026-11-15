// Журнал событий Пушика для службы ИБ: только метаданные (что за событие, программа, причина),
// без снимков, текста вопросов и ответов. Формат CEF поверх syslog. Без Electron, чтобы проверять тестами.

export type AuditFields = Record<string, string | number | boolean | null | undefined>;

export interface AuditEvent { time: Date; event: string; severity: number; fields: AuditFields }

// Имена событий для SIEM: короткий код и понятное название
export const EVENTS: Record<string, string> = {
  start: 'Pushik started',
  quit: 'Pushik quit',
  policy: 'Policy loaded',
  look: 'Screen look',
  'look.blocked': 'Screenshot refused (password or protected program)',
  chat: 'Chat question',
  'answer.blocked': 'Dangerous AI answer hidden',
  'answer.links': 'Links removed from AI answer',
  'hint.wrong': 'User marked a hint as wrong',
  pause: 'Screenshots paused by user',
  resume: 'Screenshots resumed by user',
};

const head = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const ext = (s: string): string => s.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\r?\n/g, ' ');
const key = (k: string): string => k.replace(/[^A-Za-z0-9]/g, '');

/** CEF:0|Vendor|Product|Version|SignatureID|Name|Severity|Extension */
export function cef(e: AuditEvent, version: string): string {
  const parts = [`rt=${e.time.getTime()}`];
  for (const [k, v] of Object.entries(e.fields)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${key(k)}=${ext(String(v))}`);
  }
  return `CEF:0|Pushik|Pushik|${head(version)}|${head(e.event)}|${head(EVENTS[e.event] ?? e.event)}|${Math.max(0, Math.min(10, e.severity))}|${parts.join(' ')}`;
}

/** Строка syslog (RFC 5424), facility local0, уровень из важности события. */
export function syslogLine(e: AuditEvent, host: string, version: string): string {
  const level = e.severity >= 7 ? 3 : e.severity >= 5 ? 4 : 6; // error / warning / info
  const pri = 16 * 8 + level;
  return `<${pri}>1 ${e.time.toISOString()} ${host.replace(/\s/g, '_') || '-'} Pushik - - - ${cef(e, version)}`;
}

export interface SiemTarget { host: string; port: number; proto: 'udp' | 'tcp' | 'tls' }

/** Раздел siem из политики; без адреса — журнал только на диске. */
export function parseSiem(raw: unknown): SiemTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const host = typeof o.host === 'string' ? o.host.trim() : '';
  if (!/^[A-Za-z0-9.-]{1,253}$|^\[[0-9a-f:]+\]$/i.test(host)) return null;
  const proto = o.proto === 'tcp' || o.proto === 'tls' ? o.proto : 'udp';
  const port = Number(o.port) || (proto === 'tls' ? 6514 : 514);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, proto };
}
