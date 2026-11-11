// Нажатия мыши в любом месте экрана. Окно кота пропускает клики насквозь и само их не видит,
// поэтому на время (пока висит записка у корзины или кот ведёт по шагам) спрашиваем у системы, нажата ли кнопка.
// Windows: PowerShell + GetAsyncKeyState, macOS: JXA + NSEvent.pressedMouseButtons.
import { spawn, type ChildProcess } from 'node:child_process';

const WIN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class PushKeys {
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
  public static bool Down() { return (GetAsyncKeyState(1) & 0x8000) != 0 || (GetAsyncKeyState(2) & 0x8000) != 0; }
}
"@
$prev = [PushKeys]::Down()
while ($true) {
  $d = [PushKeys]::Down()
  if ($d -and -not $prev) { [Console]::Out.WriteLine('c'); [Console]::Out.Flush() }
  $prev = $d
  Start-Sleep -Milliseconds 40
}
`;

const MAC_SCRIPT = `
ObjC.import('AppKit');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
let prev = $.NSEvent.pressedMouseButtons !== 0;
while (true) {
  const d = $.NSEvent.pressedMouseButtons !== 0;
  if (d && !prev) out.writeData($('c\\n').dataUsingEncoding($.NSUTF8StringEncoding));
  prev = d;
  delay(0.04);
}
`;

let proc: ChildProcess | null = null;
let onClick: (() => void) | null = null;
// кто сейчас ждёт нажатий (записка у корзины, подсказка по шагам) и когда слежку забыть
const users = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Сообщать о каждом нажатии мыши, пока key не вызовет stop (и не дольше maxMs).
 * Если слежка уже идёт, процесс не перезапускаем: PowerShell стартует секунду, нажатие за это время потерялось бы.
 */
export function watch(key: string, cb: () => void, maxMs = 15000): void {
  const old = users.get(key);
  if (old) clearTimeout(old);
  // забытая слежка не должна жить вечно
  users.set(key, setTimeout(() => stop(key), maxMs));
  onClick = cb;
  if (!proc) start();
}

function start(): void {
  let cmd: string;
  let args: string[];
  if (process.platform === 'win32') {
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-EncodedCommand', Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64')];
  } else if (process.platform === 'darwin') {
    cmd = '/usr/bin/osascript';
    args = ['-l', 'JavaScript', '-e', MAC_SCRIPT];
  } else {
    return;
  }
  let child: ChildProcess;
  try {
    child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return;
  }
  proc = child;
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { if (proc === child && chunk.includes('c')) onClick?.(); });
  child.on('error', () => { if (proc === child) proc = null; });
  child.on('exit', () => { if (proc === child) proc = null; });
}

/** Перестать ждать нажатий для key (без key — для всех). Процесс гасим, когда ждать больше некому. */
export function stop(key?: string): void {
  for (const [k, t] of users) {
    if (key && k !== key) continue;
    clearTimeout(t);
    users.delete(k);
  }
  if (users.size) return;
  proc?.kill();
  proc = null;
  onClick = null;
}
