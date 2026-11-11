// Нажатия мыши в любом месте экрана. Окно кота пропускает клики насквозь и само их не видит,
// поэтому на короткое время (пока висит записка у корзины) спрашиваем у системы, нажата ли кнопка.
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
let stopTimer: ReturnType<typeof setTimeout> | null = null;

/** Сообщать о каждом нажатии мыши, пока не вызовут stop (и не дольше maxMs). */
export function watch(onClick: () => void, maxMs = 15000): void {
  stop();
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
  child.stdout?.on('data', (chunk: string) => { if (proc === child && chunk.includes('c')) onClick(); });
  child.on('error', () => { if (proc === child) proc = null; });
  child.on('exit', () => { if (proc === child) proc = null; });
  // забытая слежка не должна жить вечно
  stopTimer = setTimeout(stop, maxMs);
}

export function stop(): void {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  proc?.kill();
  proc = null;
}
