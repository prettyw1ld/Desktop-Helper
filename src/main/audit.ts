// Журнал событий: строки JSON в userData/audit.log (до 2 МБ, потом audit.1.log) и, если в политике есть siem,
// те же события в SIEM по syslog (CEF). Только в корпоративном режиме. Снимков и текста разговоров здесь нет.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { chainLine, syslogLine, type AuditFields, type SiemTarget } from './audit-format';

const MAX_FILE = 2 * 1024 * 1024;
let file = '';
let siem: SiemTarget | null = null;
let version = '';
let udp: dgram.Socket | null = null;
let stream: net.Socket | null = null;
let queue: string[] = [];
// хеш прошлой строки: каждая строка ссылается на предыдущую, вырезанную или изменённую строку видно (tools/audit-verify.mjs)
let prev = '';

export function init(o: { dir: string; siem: SiemTarget | null; version: string }): void {
  file = path.join(o.dir, 'audit.log');
  siem = o.siem;
  version = o.version;
  prev = lastHash(file) || lastHash(file.replace(/\.log$/, '.1.log'));
}

const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

/** Хеш последней строки файла, чтобы цепочка продолжалась после перезапуска. */
function lastHash(f: string): string {
  try {
    const size = fs.statSync(f).size;
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(Math.min(size, 64 * 1024));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    fs.closeSync(fd);
    const last = buf.toString('utf8').trimEnd().split('\n').pop() ?? '';
    return last ? sha(last) : '';
  } catch { return ''; }
}

export const enabled = (): boolean => !!file;

function writeFile(line: string): void {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_FILE) fs.renameSync(file, file.replace(/\.log$/, '.1.log'));
    fs.appendFileSync(file, `${line}\n`);
  } catch { /* диск недоступен — журнал не должен ронять кота */ }
}

function connect(t: SiemTarget): net.Socket {
  const s = t.proto === 'tls' ? tls.connect({ host: t.host, port: t.port, servername: t.host }) : net.connect({ host: t.host, port: t.port });
  s.setTimeout(30_000, () => s.destroy());
  s.on('error', () => s.destroy());
  s.on('close', () => { if (stream === s) stream = null; });
  s.once(t.proto === 'tls' ? 'secureConnect' : 'connect', () => {
    const pending = queue;
    queue = [];
    for (const l of pending) s.write(l);
  });
  return s;
}

function send(line: string): void {
  if (!siem) return;
  if (siem.proto === 'udp') {
    if (!udp) { udp = dgram.createSocket(siem.host.includes(':') ? 'udp6' : 'udp4'); udp.on('error', () => { udp?.close(); udp = null; }); udp.unref(); }
    udp.send(Buffer.from(line), siem.port, siem.host.replace(/^\[|\]$/g, ''));
    return;
  }
  // TCP: длина перед сообщением (RFC 6587), чтобы SIEM не путала границы строк
  const framed = `${Buffer.byteLength(line)} ${line}`;
  if (stream && !stream.connecting && !stream.destroyed) { stream.write(framed); return; }
  if (queue.length < 200) queue.push(framed);
  if (!stream) stream = connect(siem);
}

/** Записать событие. severity: 0–10 по шкале CEF (3 — обычное, 6 — заметное, 8 — важное). */
export function event(name: string, fields: AuditFields = {}, severity = 3): void {
  if (!file) return;
  const e = { time: new Date(), event: name, severity, fields: { dvchost: os.hostname(), suser: os.userInfo().username, ...fields } };
  const line = chainLine({ t: e.time.toISOString(), event: name, sev: severity, ...e.fields }, prev);
  prev = sha(line);
  writeFile(line);
  try { send(syslogLine(e, os.hostname(), version)); } catch { /* сеть — не повод ломать кота */ }
}
