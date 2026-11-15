# Проба корпоративного режима Пушика на своём компьютере.
#   .\try.ps1          — включить: политика, пакет «Безопасность», проверочный ИИ, сервер админ-панели, приёмник журнала
#   .\try.ps1 -Off     — выключить: убрать политику, Пушик снова обычный
#   .\try.ps1 -Say "Отключи антивирус"  — проверочный ИИ будет отвечать этой фразой (проверка фильтра ответов)
# Запускать в PowerShell от имени администратора: политика лежит в C:\ProgramData\Pushik.
param([switch]$Off, [string]$Say = '')

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here '..\..\..')
$dir = Join-Path $env:ProgramData 'Pushik'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Запусти PowerShell от имени администратора: политика пишется в C:\ProgramData\Pushik.' -ForegroundColor Yellow; exit 1 }

function Stop-Pushik {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match 'win-unpacked' -or $_.Name -match '^(Пушик|Pushik)\.exe$' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Off) {
  Stop-Pushik
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  Write-Host 'Корпоративный режим выключен. Закрой окна проверочного ИИ, сервера и журнала и запусти Пушика как обычно.' -ForegroundColor Green
  exit 0
}

New-Item -ItemType Directory -Force (Join-Path $dir 'packs') | Out-Null
Copy-Item (Join-Path $repo 'docs\enterprise\packs\security.json') (Join-Path $dir 'packs') -Force
$policy = [ordered]@{
  org = 'Проба ИБ'
  ai = @{ kind = 'openai'; url = 'http://localhost:8898/v1'; model = 'fake-vl' }
  privacy = @{ screenshots = 'window'; denyApps = @('notepad'); masks = @('ТН-\d{6}') }
  answers = @{ allowHosts = @('corp.local') }
  presence = @{ url = 'http://localhost:8899'; secret = 'enroll-secret-0123456789'; allowHttp = $true }
  siem = @{ host = '127.0.0.1'; port = 5514; proto = 'udp' }
}
[IO.File]::WriteAllText((Join-Path $dir 'policy.json'), ($policy | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

# окна запускаем прямо через node с рабочей папкой: так русские буквы в пути не ломаются
$env:ENROLL_SECRET = 'enroll-secret-0123456789'; $env:ADMIN_PASSWORD = 'admin-password-42'; $env:PORT = '8899'
$aiArgs = @("`"$here\fake-ai.mjs`"") + $(if ($Say) { @("`"$Say`"") } else { @() })
Start-Process node -ArgumentList $aiArgs -WorkingDirectory $here
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
Write-Host "Что ушло бы к ИИ: $here\requests   Журнал Пушика: $env:APPDATA\Пушик\audit.log"
Write-Host 'Выключить: .\try.ps1 -Off'
