// Находим кнопки на экране без ИИ и без интернета, через системную «доступность».
// Windows: UI Automation (PowerShell держим запущенным, запросы идут строками JSON через stdin).
// macOS: нативный помощник на Swift (src/native/locator.swift), JXA — запасной вариант.
// Все координаты на выходе в экранных точках (DIP), как у окна кота.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { LocateQuery, LocateResult, Rect } from '../../shared/types';
import { ASSETS } from '../paths';

// ---------- Windows ----------
export const WIN_SCRIPT = (skipPid: number): string => `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class PushTop {
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string title);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  // Настоящие пиксели на любом экране и масштабе (125%, 150%, два монитора). Старые Windows: как раньше.
  public static void Init() { try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { } SetProcessDPIAware(); }
  public static long Tray() { return FindWindow("Shell_TrayWnd", null).ToInt64(); }
  // Значки рабочего стола: список внутри Progman (или WorkerW, если включены обои-слайдшоу)
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string cls, string title);
  public static long Desktop() {
    IntPtr view = FindWindowEx(FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
    IntPtr w = IntPtr.Zero;
    while (view == IntPtr.Zero && (w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null)) != IntPtr.Zero) view = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
    return view == IntPtr.Zero ? 0 : FindWindowEx(view, IntPtr.Zero, "SysListView32", null).ToInt64();
  }
  // Окна программ сверху вниз (без кота и без невидимых): "hwnd:pid"
  public static string[] List(uint skipPid, int max) {
    var res = new List<string>();
    IntPtr h = GetTopWindow(IntPtr.Zero);
    while (h != IntPtr.Zero && res.Count < max) {
      if (IsWindowVisible(h) && !IsIconic(h) && GetWindowTextLength(h) > 0 && (GetWindowLong(h, -20) & 0x80) == 0) {
        int cloaked;
        if (!(DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0)) {
          uint pid; GetWindowThreadProcessId(h, out pid);
          if (pid != skipPid) res.Add(h.ToInt64() + ":" + pid);
        }
      }
      h = GetWindow(h, 2);
    }
    return res.ToArray();
  }
}
"@
[PushTop]::Init()
# Громкость системы (Core Audio). Если не получилось, урок просто попросит нажать «Сделал».
try {
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPushVol {
  int f1(); int f2(); int f3(); int f4(); int f5(); int f6();
  int GetMasterVolumeLevelScalar(out float level);
  int f8(); int f9(); int f10(); int f11(); int f12();
  int GetMute(out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPushDev { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPushEnum { int f1(); int GetDefaultAudioEndpoint(int flow, int role, out IPushDev dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class PushEnumCls { }
public static class PushVol {
  static IPushVol Get() {
    var en = (IPushEnum)(new PushEnumCls());
    IPushDev dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    var iid = typeof(IPushVol).GUID; object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IPushVol)o;
  }
  public static float Level() { float v; Marshal.ThrowExceptionForHR(Get().GetMasterVolumeLevelScalar(out v)); return v; }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Get().GetMute(out m)); return m; }
}
"@
} catch { }
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Wins($max) {
  $out = @()
  foreach ($s in [PushTop]::List(${skipPid}, $max)) {
    $p = $s.Split(':')
    $el = $AE::FromHandle([IntPtr][long]$p[0])
    $proc = ''
    try { $proc = [System.Diagnostics.Process]::GetProcessById([int]$p[1]).ProcessName } catch {}
    if ($el) { $out += ,@($el, $proc) }
  }
  return ,$out
}

function Rect($el) {
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -lt 2 -or $r.Height -lt 2) { return $null }
  return @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
}

# Кнопку не закрывает другое окно: в её середине на экране именно эта программа.
# Иначе кот показывал бы на кнопку из окна, которое лежит позади.
function Visible($el, $r) {
  try {
    $pt = New-Object System.Windows.Point(($r.x + $r.w / 2), ($r.y + $r.h / 2))
    $hit = $AE::FromPoint($pt)
    if (-not $hit) { return $true }
    $hp = $hit.Current.ProcessId
    return ($hp -eq $el.Current.ProcessId -or $hp -eq ${skipPid})
  } catch { return $true }
}

function Roots($scope) {
  $roots = @()
  if ($scope -eq 'taskbar') {
    $h = [PushTop]::Tray()
    if ($h -ne 0) { $roots += ,@($AE::FromHandle([IntPtr]$h), 'explorer') }
  } elseif ($scope -eq 'start') {
    # меню «Пуск» и поиск Windows 10/11
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Windows.UI.Core.CoreWindow')
    foreach ($el in $AE::RootElement.FindAll($TS::Children, $cond)) {
      if (-not $el.Current.IsOffscreen) { $roots += ,@($el, 'start') }
    }
  } elseif ($scope -eq 'popup') {
    # всплывающие панели Windows (громкость, быстрые настройки) и верхнее окно (Параметры)
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Windows.UI.Core.CoreWindow')
    foreach ($el in $AE::RootElement.FindAll($TS::Children, $cond)) {
      if (-not $el.Current.IsOffscreen) { $roots += ,@($el, 'popup') }
    }
    $w = Wins 1
    if ($w.Count) { $roots += ,$w[0] }
  } elseif ($scope -eq 'top') {
    $w = Wins 1
    if ($w.Count) { $roots += ,$w[0] }
  } elseif ($scope -like 'proc:*') {
    $rx = $scope.Substring(5)
    foreach ($w in (Wins 15)) {
      if ($w[1] -notmatch $rx) { continue }
      # у Проводника берём только окна с папками, не рабочий стол и не панель задач
      if ($w[1] -eq 'explorer' -and $w[0].Current.ClassName -ne 'CabinetWClass') { continue }
      $roots += ,$w
      if ($roots.Count -ge 2) { break }
    }
  } else {
    $roots = Wins 4
  }
  return ,$roots
}

function Find($q) {
  $types = @($q.types | Where-Object { $_ })
  $cond = [System.Windows.Automation.Condition]::TrueCondition
  if ($types.Count -gt 0) {
    $conds = @()
    foreach ($t in $types) {
      $f = [System.Windows.Automation.ControlType].GetField($t)
      if ($f) { $conds += New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $f.GetValue($null)) }
    }
    if ($conds.Count -eq 1) { $cond = $conds[0] }
    elseif ($conds.Count -gt 1) { $cond = New-Object System.Windows.Automation.OrCondition($conds) }
  }
  $items = @()
  $win = $null
  foreach ($root in (Roots $q.scope)) {
    $el0 = $root[0]
    if (-not $win) { $win = @{ title = $el0.Current.Name; proc = $root[1] } }
    $found = $el0.FindAll($TS::Descendants, $cond)
    foreach ($el in $found) {
      $c = $el.Current
      if ($c.IsOffscreen) { continue }
      if ($q.name -and -not ($c.Name -match $q.name -or $c.AutomationId -match $q.name)) { continue }
      $r = Rect $el
      if (-not $r) { continue }
      if (-not (Visible $el $r)) { continue }
      $r.name = $c.Name
      $r.type = $c.ControlType.ProgrammaticName -replace 'ControlType\\.', ''
      $r.focused = $c.HasKeyboardFocus
      $r.enabled = $c.IsEnabled
      $r.proc = $root[1]
      $items += $r
      if ($items.Count -ge 6) { break }
    }
    if ($items.Count -ge 6) { break }
  }
  return @{ items = $items; win = $win }
}

function Top() {
  $w = Wins 1
  if (-not $w.Count) { return @{ win = $null } }
  $el = $w[0][0]
  $close = $null
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  foreach ($b in $el.FindAll($TS::Descendants, $cond)) {
    $c = $b.Current
    if ($c.AutomationId -eq 'Close' -or $c.Name -match '^(Закрыть|Close)$') { $close = Rect $b; if ($close) { break } }
  }
  return @{ win = @{ title = $el.Current.Name; proc = $w[0][1]; rect = (Rect $el); close = $close } }
}

# Первое окно программы (для Проводника: настоящее окно с папкой, не рабочий стол и не панель задач)
# и папка, открытая в нём. Нужно урокам про файлы: человек вошёл в папку или вернулся назад.
function Window($q) {
  $rx = '.'
  if ($q.scope -like 'proc:*') { $rx = $q.scope.Substring(5) }
  foreach ($w in (Wins 20)) {
    if ($w[1] -notmatch $rx) { continue }
    $el = $w[0]
    $cls = $el.Current.ClassName
    if ($w[1] -eq 'explorer' -and $cls -ne 'CabinetWClass') { continue }
    $title = $el.Current.Name -replace '\s+[-—–]\s+(Проводник|File Explorer)$', ''
    $folder = ''
    try {
      $h = [long]$el.Current.NativeWindowHandle
      foreach ($sw in (New-Object -ComObject Shell.Application).Windows()) {
        if ([long]$sw.HWND -eq $h) { $folder = [string]$sw.Document.Folder.Self.Path; if ($sw.LocationName) { $title = [string]$sw.LocationName }; break }
      }
    } catch {}
    return @{ win = @{ title = $title; proc = $w[1]; folder = $folder; rect = (Rect $el) } }
  }
  return @{ win = $null }
}

# Все нажимаемые элементы на виду: панель задач, «Пуск» и всплывающие панели, верхнее окно, рабочий стол.
# ИИ выбирает из них номер, и кот показывает точно в кнопку, а не туда, где ИИ «на глаз» её увидел.
# Обходим дерево вширь с ограничением по времени, чтобы помощник никогда не ждал дольше бюджета.
function ListAll($q) {
  $budget = 1200
  if ($q.budget) { $budget = [int]$q.budget }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $cr = New-Object System.Windows.Automation.CacheRequest
  foreach ($p in @($AE::NameProperty, $AE::ControlTypeProperty, $AE::BoundingRectangleProperty, $AE::IsOffscreenProperty, $AE::IsEnabledProperty)) { $cr.Add($p) }
  $cr.TreeScope = $TS::Element
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $want = @('Button','SplitButton','MenuItem','TabItem','ListItem','TreeItem','DataItem','Edit','ComboBox','Hyperlink','CheckBox','RadioButton','Slider')
  $roots = @()
  $h = [PushTop]::Tray()
  if ($h -ne 0) { $roots += ,@($AE::FromHandle([IntPtr]$h), 'taskbar') }
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Windows.UI.Core.CoreWindow')
  foreach ($el in $AE::RootElement.FindAll($TS::Children, $cond)) {
    if (-not $el.Current.IsOffscreen) { $roots += ,@($el, 'popup') }
  }
  foreach ($w in (Wins 1)) { $roots += ,@($w[0], 'window') }
  $pm = [PushTop]::Desktop()
  if ($pm -ne 0) { $roots += ,@($AE::FromHandle([IntPtr]$pm), 'desktop') }
  $items = @()
  foreach ($root in $roots) {
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($root[0], 0))
    $area = $root[1]
    # на каждую область своя доля времени, чтобы большое окно браузера не съело всё
    $stop = $sw.ElapsedMilliseconds + [Math]::Max(150, ($budget - $sw.ElapsedMilliseconds) / 2)
    if ($area -eq 'taskbar') { $stop = $sw.ElapsedMilliseconds + 400 }
    while ($queue.Count -gt 0 -and $items.Count -lt 180) {
      if ($sw.ElapsedMilliseconds -gt $stop -or $sw.ElapsedMilliseconds -gt $budget) { break }
      $pair = $queue.Dequeue()
      $node = $pair[0]
      $depth = $pair[1]
      $child = $null
      try { $child = $walker.GetFirstChild($node, $cr) } catch { }
      while ($child) {
        try {
          $c = $child.Cached
          if (-not $c.IsOffscreen) {
            $type = $c.ControlType.ProgrammaticName -replace 'ControlType\\.', ''
            $r = $c.BoundingRectangle
            if ($want -contains $type -and -not $r.IsEmpty -and $r.Width -ge 4 -and $r.Height -ge 4 -and ($c.Name -or $type -eq 'Edit')) {
              $items += @{ name = [string]$c.Name; type = $type; area = $area; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; enabled = $c.IsEnabled; focused = $false; proc = '' }
            }
            if ($depth -lt 30) { $queue.Enqueue(@($child, ($depth + 1))) }
          }
        } catch { }
        if ($sw.ElapsedMilliseconds -gt $budget) { break }
        try { $child = $walker.GetNextSibling($child, $cr) } catch { $child = $null }
      }
    }
  }
  return @{ items = $items; ms = $sw.ElapsedMilliseconds }
}

function Volume() {
  return @{ volume = [Math]::Round([PushVol]::Level(), 3); muted = [PushVol]::Muted() }
}

function Drives() {
  $out = @()
  foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2')) {
    $out += @{ letter = $d.DeviceID.TrimEnd(':'); label = [string]$d.VolumeName }
  }
  return @{ drives = $out }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $res = @{}
  try {
    $q = $line | ConvertFrom-Json
    if ($q.op -eq 'find') { $res = Find $q }
    elseif ($q.op -eq 'top') { $res = Top }
    elseif ($q.op -eq 'window') { $res = Window $q }
    elseif ($q.op -eq 'drives') { $res = Drives }
    elseif ($q.op -eq 'volume') { $res = Volume }
    elseif ($q.op -eq 'list') { $res = ListAll $q }
    $res.id = $q.id
  } catch {
    $res = @{ id = $q.id; error = [string]$_ }
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
`;

let ps: ChildProcessWithoutNullStreams | null = null;
let seq = 0;
const pending = new Map<number, (res: LocateResult) => void>();

// Кириллицу передаём экранированной: так кодировка консоли не важна.
const asciiJson = (o: unknown): string => JSON.stringify(o).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function winServer(): ChildProcessWithoutNullStreams {
  if (ps) return ps;
  const encoded = Buffer.from(WIN_SCRIPT(process.pid), 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  ps = child;
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const res = JSON.parse(line.trim()) as LocateResult & { id: number };
        const p = pending.get(res.id);
        if (p) { pending.delete(res.id); p(res); }
      } catch { /* не JSON, пропускаем */ }
    }
  });
  child.stderr.resume(); // ошибки PowerShell не нужны, но поток надо читать
  const dead = () => {
    if (ps === child) ps = null;
    for (const p of pending.values()) p({ error: 'locator stopped' });
    pending.clear();
  };
  child.on('exit', dead);
  child.on('error', dead);
  return child;
}

function winAsk(q: LocateQuery, timeout = 6000): Promise<LocateResult> {
  return new Promise((resolve) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); resolve({ error: 'timeout' }); }, timeout);
    pending.set(id, (res) => { clearTimeout(t); resolve(res); });
    try {
      winServer().stdin.write(`${asciiJson({ ...q, id })}\n`);
    } catch {
      clearTimeout(t);
      pending.delete(id);
      resolve({ error: 'no powershell' });
    }
  });
}

// ---------- macOS ----------
export const MAC_ROLES: Record<string, string[]> = {
  Button: ['AXButton', 'AXDockItem', 'AXMenuButton', 'AXPopUpButton'],
  Edit: ['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSearchField'],
  ListItem: ['AXRow', 'AXCell', 'AXStaticText', 'AXImage', 'AXTextField'],
  TreeItem: ['AXRow', 'AXCell', 'AXStaticText'],
  DataItem: ['AXRow', 'AXCell'],
  Text: ['AXStaticText'],
  Slider: ['AXSlider'],
};

export const MAC_SCRIPT = (q: LocateQuery & { roles: string[] }, skipPid: number): string => `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
const se = Application('System Events');
const q = ${JSON.stringify(q)};
function topPid() {
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || [];
  for (const w of list) if (w.kCGWindowLayer === 0 && w.kCGWindowOwnerPID !== ${skipPid} && w.kCGWindowAlpha !== 0 && w.kCGWindowBounds?.Width >= 100 && w.kCGWindowBounds?.Height >= 80) return w.kCGWindowOwnerPID;
  return 0;
}
function rectOf(e) { try { const p = e.position(); const s = e.size(); if (!p || !s || s[0] < 2 || s[1] < 2) return null; return { x: p[0], y: p[1], w: s[0], h: s[1] }; } catch (_) { return null; } }
function label(e) { const out = []; for (const k of ['name', 'title', 'description', 'value']) { try { const v = e[k](); if (v && typeof v === 'string') out.push(v); } catch (_) {} } return out.join(' '); }
// macOS can put WindowSharingSessionButton's tiny AXWindow before real windows.
function usableWindows(p) {
  return p.windows().filter((w) => {
    const r = rectOf(w);
    if (!r || r.w < 100 || r.h < 80) return false;
    try { if (w.attributes.byName('AXMinimized').value()) return false; } catch (_) {}
    return true;
  });
}
function roots() {
  if (q.scope === 'taskbar') return [[se.processes.byName('Dock').lists[0], 'Dock']];
  const out = [];
  if (q.scope && q.scope.startsWith('proc:')) {
    const rx = new RegExp(q.scope.slice(5), 'i');
    for (const p of se.processes.whose({ backgroundOnly: false })()) { try { if (rx.test(p.name())) for (const w of usableWindows(p)) { out.push([w, p.name()]); if (q.firstWindow) break; } } catch (_) {} }
    return out;
  }
  const pid = topPid();
  if (!pid) return out;
  const p = se.processes.whose({ unixId: pid })[0];
  try { const w = usableWindows(p)[0]; if (w) out.push([w, p.name()]); } catch (_) {}
  return out;
}
function query() {
  if (q.op === 'volume') {
    const a = Application.currentApplication();
    a.includeStandardAdditions = true;
    const v = a.getVolumeSettings();
    return { volume: Math.round(v.outputVolume) / 100, muted: !!v.outputMuted };
  }
  if (q.op === 'drives') {
    const fm = $.NSFileManager.defaultManager;
    const names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError('/Volumes', null)) || [];
    const root = ObjC.unwrap($.NSString.stringWithString('/').stringByResolvingSymlinksInPath);
    const drives = [];
    for (const n of names) {
      const path = ObjC.unwrap($.NSString.stringWithString('/Volumes/' + n).stringByResolvingSymlinksInPath);
      if (path !== root && !/^(Macintosh HD|Recovery|Preboot|VM|Data)$/.test(n)) drives.push({ letter: n, label: n });
    }
    return { drives };
  }
  const rs = roots();
  const win = rs[0] ? { title: (() => { try { return rs[0][0].name(); } catch (_) { return ''; } })(), proc: rs[0][1] } : null;
  if (q.op === 'top' || q.op === 'window') {
    if (!rs[0]) return { win: null };
    let close = null;
    try { const b = rs[0][0].buttons.whose({ subrole: 'AXCloseButton' })[0]; close = rectOf(b); } catch (_) {}
    return { win: Object.assign(win, { rect: rectOf(rs[0][0]), close }) };
  }
  const roles = q.roles || [];
  const rx = q.name ? new RegExp(q.name, 'i') : null;
  const items = [];
  for (const [r, proc] of rs) {
    let all = [];
    try { all = q.scope === 'taskbar' ? r.uiElements() : r.entireContents(); } catch (_) {}
    for (const e of all) {
      if (items.length >= 6) break;
      let role = '';
      try { role = e.role(); } catch (_) { continue; }
      if (roles.length && !roles.includes(role)) continue;
      const name = label(e);
      if (rx && !rx.test(name)) continue;
      const rect = rectOf(e);
      if (!rect) continue;
      let focused = false;
      try { focused = !!e.focused(); } catch (_) {}
      items.push(Object.assign(rect, { name, type: role, focused, enabled: true, proc }));
    }
  }
  return { items, win };
}
// osascript calls the run handler, ignoring the last top-level expression.
function run() {
  try { return JSON.stringify(query()); }
  catch (error) { return JSON.stringify({ error: String(error) }); }
}
`;

const macError = (message: string): string =>
  /not authorized|-1743/i.test(message) ? 'automation'
    : /not allowed|assistive|-1719|-25211/i.test(message) ? 'access'
      : message;

function macAsk(q: LocateQuery, timeout = 8000): Promise<LocateResult> {
  const helper = path.join(ASSETS, 'mac', `locator-${process.arch}`);
  const roles = [...new Set((q.types || []).flatMap((t) => MAC_ROLES[t] || []))];
  return new Promise((resolve) => {
    const native = fs.existsSync(helper) && q.op !== 'drives';
    const executable = native ? helper : '/usr/bin/osascript';
    const args = native
      ? [JSON.stringify({ ...q, roles, skipPid: process.pid })]
      : ['-l', 'JavaScript', '-e', MAC_SCRIPT({ ...q, roles }, process.pid)];
    execFile(executable, args, { timeout }, (err, out, errOut) => {
      if (err) {
        const kind = macError(String(errOut || err.message));
        resolve({ error: kind === 'access' || kind === 'automation' ? kind : err.killed ? 'timeout' : 'locator' });
        return;
      }
      try {
        const res = JSON.parse(out) as LocateResult;
        if (res.error) res.error = macError(res.error);
        resolve(res);
      } catch {
        resolve({ error: 'bad output' });
      }
    });
  });
}

// ---------- Общее ----------
export const supported = (): boolean => process.platform === 'win32' || process.platform === 'darwin';

/** Экранный прямоугольник → координаты окна кота; null, если он на другом мониторе. */
export type ToOverlay = (r: Rect, keep?: boolean) => Rect | null;

export async function ask(q: LocateQuery, toOverlay: ToOverlay = (r) => r): Promise<LocateResult> {
  if (!supported()) return { error: 'unsupported' };
  const res = process.platform === 'win32' ? await winAsk(q) : await macAsk(q);
  // кнопку на другом мониторе кот показать не может: убираем
  if (res.items) {
    res.items = res.items.flatMap((it) => {
      const o = toOverlay(it);
      return o ? [{ ...it, ...o }] : [];
    });
  }
  if (res.win?.rect) res.win.rect = toOverlay(res.win.rect, true);
  if (res.win?.close) res.win.close = toOverlay(res.win.close);
  return res;
}

/** Запустить PowerShell заранее: первый запуск с компиляцией C# занимает пару секунд, пусть это будет не во время подсказки. */
export function warm(): void {
  if (process.platform === 'win32') { try { winServer(); } catch { /* нет PowerShell: кот обойдётся рамкой ИИ */ } }
}

export function stop(): void {
  if (!ps) return;
  try { ps.kill(); } catch { /* уже нет */ }
  ps = null;
}
