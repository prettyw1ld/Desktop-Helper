# Проба корпоративного режима Пушика на своём компьютере.
#   .\try.ps1          — включить: политика, пакет «Безопасность», локальная модель в Ollama, сервер админ-панели, приёмник журнала
#   .\try.ps1 -Off     — выключить: убрать политику, Пушик снова обычный
#   .\try.ps1 -Model qwen2.5vl:3b       — другая модель Ollama (нужна модель, которая видит картинки)
#   .\try.ps1 -FakeAi  — вместо модели проверочный ИИ: отвечает одной фразой и сохраняет запросы в requests\
#   .\try.ps1 -Say "Отключи антивирус"  — проверочный ИИ будет отвечать этой фразой (проверка фильтра ответов)
# Права администратора нужны только для записи в C:\ProgramData\Pushik: это делает отдельное окно, о котором Windows спросит.
# Серверы, модель и сам Пушик запускаются без прав администратора.
param([switch]$Off, [string]$Say = '', [switch]$FakeAi, [string]$Model = 'qwen3-vl:4b-instruct', [string]$Install = '', [switch]$Remove)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here '..\..\..')
$dir = Join-Path $env:ProgramData 'Pushik'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Запись в C:\ProgramData\Pushik (с правами администратора): папка, политика, пакет и права «пишут только администраторы».
function Install-Policy([string]$from) {
  New-Item -ItemType Directory -Force (Join-Path $dir 'packs') | Out-Null
  & icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
  Copy-Item (Join-Path $from 'policy.json') (Join-Path $dir 'policy.json') -Force
  Copy-Item (Join-Path $from 'security.json') (Join-Path $dir 'packs\security.json') -Force
  & icacls $dir /setowner '*S-1-5-32-544' /T | Out-Null
}

# Запускает этот же скрипт с правами администратора только для записи в ProgramData и ждёт его.
function Invoke-Elevated([string[]]$scriptArgs) {
  if ($admin) { return $false }
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"") + $scriptArgs
  $p = Start-Process powershell -Verb RunAs -ArgumentList $a -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Запись в $dir не удалась (код $($p.ExitCode))" }
  return $true
}

if ($Install) { Install-Policy $Install; exit 0 }
if ($Remove) { if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }; exit 0 }

function Stop-Pushik {
  # собранный Пушик и Пушик из npm start (electron.exe из node_modules этого проекта)
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match 'win-unpacked' -or $_.Name -match '^(Пушик|Pushik)\.exe$' -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith("$repo\node_modules\electron", 'OrdinalIgnoreCase')) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Off) {
  Stop-Pushik
  if (-not (Invoke-Elevated @('-Remove'))) { if (Test-Path $dir) { Remove-Item -Recurse -Force $dir } }
  Write-Host 'Корпоративный режим выключен. Закрой окна проверочного ИИ, сервера и журнала и запусти Пушика как обычно.' -ForegroundColor Green
  exit 0
}

function Find-Ollama {
  $c = Get-Command ollama -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $p) { return $p }
  return $null
}

function Test-Ollama {
  try { Invoke-WebRequest -UseBasicParsing http://localhost:11434/api/version -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

# Локальная модель: Ollama на этом компьютере, OpenAI-совместимый адрес http://localhost:11434/v1.
# Снимок экрана и правила урока длинные: окно контекста 8192 вместо 4096, модель держим в памяти 30 минут.
$useFake = $FakeAi -or [bool]$Say
if (-not $useFake) {
  $ollama = Find-Ollama
  if (-not $ollama) {
    Write-Host 'Ollama не найдена: поставь её (winget install Ollama.Ollama) или запусти с -FakeAi. Пока включаю проверочный ИИ.' -ForegroundColor Yellow
    $useFake = $true
  } else {
    if (-not (Test-Ollama)) {
      $env:OLLAMA_CONTEXT_LENGTH = '8192'; $env:OLLAMA_KEEP_ALIVE = '30m'
      Start-Process $ollama -ArgumentList 'serve' -WindowStyle Hidden
      foreach ($i in 1..15) { Start-Sleep 1; if (Test-Ollama) { break } }
    }
    if (-not (Test-Ollama)) {
      Write-Host 'Ollama не отвечает на http://localhost:11434. Пока включаю проверочный ИИ.' -ForegroundColor Yellow
      $useFake = $true
    } elseif (-not ((& $ollama list) -match "^$([regex]::Escape($Model))\s")) {
      Write-Host "Скачиваю модель $Model (несколько гигабайт, один раз)..."
      & $ollama pull $Model
      if ($LASTEXITCODE -ne 0) { Write-Host "Модель $Model не скачалась. Пока включаю проверочный ИИ." -ForegroundColor Yellow; $useFake = $true }
    }
  }
}
$ai = if ($useFake) { @{ kind = 'openai'; url = 'http://localhost:8898/v1'; model = 'fake-vl' } } else { @{ kind = 'openai'; url = 'http://localhost:11434/v1'; model = $Model } }

$policy = [ordered]@{
  org = 'Проба ИБ'
  ai = $ai
  privacy = @{ screenshots = 'window'; denyApps = @('notepad'); masks = @('ТН-\d{6}') }
  answers = @{ allowHosts = @('corp.local') }
  presence = @{ url = 'http://localhost:8899'; secret = 'enroll-secret-0123456789'; allowHttp = $true; group = 'Отдел ИБ' }
  siem = @{ host = '127.0.0.1'; port = 5514; proto = 'udp' }
  tunnels = @{ action = 'stop' }   # туннели наружу (cloudflared, ngrok, ssh -R) кот закрывает
}
# политику собираем во временной папке, а в ProgramData её кладёт окно с правами администратора
$stage = Join-Path $env:TEMP 'pushik-try'
New-Item -ItemType Directory -Force $stage | Out-Null
[IO.File]::WriteAllText((Join-Path $stage 'policy.json'), ($policy | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
Copy-Item (Join-Path $repo 'docs\enterprise\packs\security.json') (Join-Path $stage 'security.json') -Force
if (-not (Invoke-Elevated @('-Install', "`"$stage`""))) { Install-Policy $stage }

# окна запускаем прямо через node с рабочей папкой: так русские буквы в пути не ломаются
# сервер админ-панели слушает только этот компьютер: пароль пробный и известен всем
$env:ENROLL_SECRET = 'enroll-secret-0123456789'; $env:ADMIN_PASSWORD = 'admin-password-42'; $env:PORT = '8899'; $env:HOST = '127.0.0.1'
if ($useFake) {
  $aiArgs = @("`"$here\fake-ai.mjs`"") + $(if ($Say) { @("`"$Say`"") } else { @() })
  Start-Process node -ArgumentList $aiArgs -WorkingDirectory $here
}
Start-Process node -ArgumentList 'index.mjs' -WorkingDirectory (Join-Path $repo 'server')
Start-Process node -ArgumentList "`"$here\siem-listen.mjs`"" -WorkingDirectory $here
Start-Sleep 2
try { Invoke-WebRequest -UseBasicParsing http://localhost:8899/api/devices -TimeoutSec 3 | Out-Null } catch {
  if (-not $_.Exception.Response) { Write-Host 'Сервер админ-панели не запустился: посмотри окно node с index.mjs.' -ForegroundColor Yellow }
}

Stop-Pushik
Start-Sleep 2
$exe = Get-ChildItem (Join-Path $repo 'dist\win-unpacked\*.exe') -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'Uninstall' } | Select-Object -First 1
if ($exe) { Start-Process $exe.FullName } else { Write-Host 'Сборки нет: выполни npx electron-builder --win --dir в папке проекта и запусти dist\win-unpacked\Пушик.exe' -ForegroundColor Yellow }
Start-Sleep 3
Start-Process 'http://localhost:8899/'
Write-Host ''
Write-Host 'Готово. Админ-панель: http://localhost:8899  (логин admin, пароль admin-password-42)' -ForegroundColor Green
if ($useFake) { Write-Host "ИИ: проверочный. Что ушло бы к ИИ: $here\requests" } else { Write-Host "ИИ: локальная модель $Model в Ollama (http://localhost:11434/v1)" }
Write-Host "Журнал Пушика: $env:APPDATA\Пушик\audit.log"
Write-Host 'Выключить: .\try.ps1 -Off'
