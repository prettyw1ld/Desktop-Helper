// Кто может менять политику. Политика и пакеты организации — это доверенные настройки: адрес модели,
// правила для ИИ. Если обычный пользователь (или программа, запущенная им) может положить или поправить
// такой файл, он перенаправит запросы ИИ на свой сервер. Поэтому файл принимается, только если писать
// в него и в его папку могут лишь система и администраторы.
//
// По умолчанию в %ProgramData% обычные пользователи могут создавать файлы и папки. Установщик и
// инструкция (docs/enterprise/policy.md) закрывают это для папки Pushik; здесь — проверка при запуске.
// Без Electron, чтобы проверять тестами.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Запись ACL: SID, права (FileSystemRights числом), разрешение или запрет, только для наследования. */
export interface Ace { sid: string; rights: number; allow: boolean; inheritOnly: boolean }
export interface AclEntry { path: string; owner: string; aces: Ace[] }

// SYSTEM, Администраторы, TrustedInstaller
export const ADMIN_SIDS = new Set(['S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464']);
const CREATOR_OWNER = 'S-1-3-0';

// права, которые позволяют подменить файл или добавить свой: запись/создание файла, дописывание/создание
// папки, удаление вложенного, удаление, смена прав и владельца, GENERIC_ALL и GENERIC_WRITE
const WRITE_MASK = 0x2 | 0x4 | 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000;

// В папке по умолчанию пользователи могут создавать файлы (так устроен %ProgramData%): это не страшно,
// у созданного ими файла владелец — они сами, и такой файл не примется. Опасно другое: удалить или
// подменить чужой файл, сменить права папки.
const DIR_MASK = WRITE_MASK & ~(0x2 | 0x4);

/**
 * Почему этому файлу или папке нельзя верить; пусто — можно. Владелец — только система или группа
 * «Администраторы» (так бывает, когда файл кладёт установщик, Intune/SCCM/GPO или администратор
 * из окна «от имени администратора»). Файл, созданный обычным процессом даже у администратора, не примется:
 * такой процесс мог запустить кто угодно.
 */
export function aclProblem(e: AclEntry, dir = false): string {
  const trusted = (sid: string): boolean => ADMIN_SIDS.has(sid);
  if (!e.owner) return `${e.path}: owner unknown`;
  if (!trusted(e.owner)) return `${e.path}: owner ${e.owner} is not SYSTEM or Administrators`;
  const mask = dir ? DIR_MASK : WRITE_MASK;
  for (const a of e.aces) {
    if (!a.allow || !(a.rights & mask)) continue;
    if (trusted(a.sid)) continue;
    if (a.sid === CREATOR_OWNER && a.inheritOnly) continue; // относится к будущим файлам, их владельца проверим тогда
    return `${e.path}: ${a.sid} can write`;
  }
  return '';
}

/** Разбор вывода ACL_SCRIPT: «P|путь|владелец» и после него «A|sid|права|Allow|True». */
export function parseAclOutput(out: string): AclEntry[] {
  const entries: AclEntry[] = [];
  for (const line of out.split(/\r?\n/)) {
    const f = line.split('|');
    if (f[0] === 'P' && f.length >= 3) entries.push({ path: f[1]!, owner: f[2]!.trim(), aces: [] });
    else if (f[0] === 'A' && f.length >= 5 && entries.length) {
      entries[entries.length - 1]!.aces.push({ sid: f[1]!.trim(), rights: Number(f[2]) >>> 0, allow: f[3]!.trim() === 'Allow', inheritOnly: /true/i.test(f[4]!) });
    }
  }
  return entries;
}

// Один запуск PowerShell на все пути. SID вместо имён: имена групп на русской Windows другие.
const ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$sidT = [System.Security.Principal.SecurityIdentifier]
foreach ($p in $env:PUSHIK_ACL_PATHS.Split([char]10)) {
  if (-not $p) { continue }
  $acl = Get-Acl -LiteralPath $p
  if (-not $acl) { 'P|' + $p + '|'; continue }
  'P|' + $p + '|' + $acl.GetOwner($sidT).Value
  foreach ($r in $acl.GetAccessRules($true, $true, $sidT)) {
    'A|' + $r.IdentityReference.Value + '|' + [int64]$r.FileSystemRights + '|' + $r.AccessControlType + '|' + ((($r.PropagationFlags -band 2)) -ne 0)
  }
}`;

/** Unix: файл и папка принадлежат root и никто другой в них не пишет. */
export function unixProblem(p: string, st: { uid: number; mode: number }): string {
  if (st.uid !== 0) return `${p}: owner uid ${st.uid} is not root`;
  if (st.mode & 0o022) return `${p}: writable by group or others`;
  return '';
}

/** Проблемы с правами для списка путей (файлы и папки). Пусто — всем можно верить. */
export function checkPaths(paths: string[], platform = process.platform): Map<string, string> {
  const res = new Map<string, string>();
  if (!paths.length) return res;
  if (platform !== 'win32') {
    for (const p of paths) {
      try { const pr = unixProblem(p, fs.statSync(p)); if (pr) res.set(p, pr); } catch { res.set(p, `${p}: cannot stat`); }
    }
    return res;
  }
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ACL_SCRIPT], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, PUSHIK_ACL_PATHS: paths.join('\n') },
    });
  } catch { /* не смогли проверить — ниже все пути без записи считаются недоверенными */ }
  const entries = parseAclOutput(out);
  for (const p of paths) {
    const e = entries.find((x) => path.normalize(x.path).toLowerCase() === path.normalize(p).toLowerCase());
    let dir = false;
    try { dir = fs.statSync(p).isDirectory(); } catch { /* пропал — проверка ниже не пройдёт */ }
    const pr = e ? aclProblem(e, dir) : `${p}: ACL not read`;
    if (pr) res.set(p, pr);
  }
  return res;
}

/** Пути, которые нужно проверить для политики: её папка, сам файл, папка пакетов и пакеты в ней. */
export function policyPaths(file: string): string[] {
  const dir = path.dirname(file);
  const list = [dir];
  if (fs.existsSync(file)) list.push(file);
  const packs = path.join(dir, 'packs');
  if (fs.existsSync(packs)) {
    list.push(packs);
    try { for (const n of fs.readdirSync(packs)) if (n.toLowerCase().endsWith('.json')) list.push(path.join(packs, n)); } catch { /* нет доступа */ }
  }
  return list;
}
