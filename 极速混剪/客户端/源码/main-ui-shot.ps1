#requires -version 7
# 走真实流程：起后台 -> 发激活码 -> 客户端里粘贴激活码并登录 -> 确认票据落盘
# -> 截图主界面 -> 重启客户端 -> 截图（停在激活页，激活码已自动带出）。
# 用剪贴板粘贴，避免 SendKeys 丢字符。
param(
    [string]$Dir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\shots\app',
    [string]$OutMain = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\截图\7-激活成功-主界面-极速VideoMix.png',
    [string]$OutRestart = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\截图\8-再次启动-记住的激活码自动带出.png',
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$SignKey = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\keys\license-private.xml',
    [string]$DataDir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\mainui\data',
    [int]$Port = 8082,
    [switch]$Keep
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$base = "http://127.0.0.1:$Port"
$ticketFile = Join-Path $Dir 'license-ticket.json'
$clientLog = Join-Path $Dir 'license-client.log'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class UiHelp {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT4 r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
public struct RECT4 { public int Left, Top, Right, Bottom; }
'@

function Stop-Clients {
    foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
        Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Get-ClientWindow {
    Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

function Click-At([int]$x, [int]$y) {
    [void][UiHelp]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 250
    [UiHelp]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [UiHelp]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 250
}

function Save-Shot($window, [string]$path) {
    [void][UiHelp]::SetForegroundWindow($window.MainWindowHandle)
    Start-Sleep -Milliseconds 900
    $rect = New-Object RECT4
    [void][UiHelp]::GetWindowRect($window.MainWindowHandle, [ref]$rect)
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("  截图 {0}（{1}x{2}）" -f $path, $w, $h)
}

Stop-Clients
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if (Test-Path -LiteralPath $ticketFile) { Remove-Item -LiteralPath $ticketFile -Force }
if (Test-Path -LiteralPath $clientLog) { Remove-Item -LiteralPath $clientLog -Force }

Write-Output '--- 启动测试后台 ---'
$web = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port", '--data-dir', "`"$DataDir`"", '--signing-key', "`"$SignKey`"") `
    -WorkingDirectory $WebDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $DataDir 'out.log') -RedirectStandardError (Join-Path $DataDir 'err.log')
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { if ((Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3).ok) { break } } catch { }
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-RestMethod "$base/api/login" -Method Post -NoProxy -WebSession $session `
    -ContentType 'application/json' -Body (@{ username = 'admin'; password = 'admin123' } | ConvertTo-Json -Compress)
$batch = Invoke-RestMethod "$base/api/batches" -Method Post -NoProxy -WebSession $session `
    -ContentType 'application/json' -Body (@{ name = '主界面截图'; quantity = 1; days = 365; maxDevices = 1 } | ConvertTo-Json -Compress)
$code = (Invoke-RestMethod "$base/api/codes?batchId=$($batch.id)" -NoProxy -WebSession $session).data[0].code
Write-Output "  激活码：$code"

$local = @{ serverUrl = $base } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $Dir 'license-server.json'), $local,
    (New-Object System.Text.UTF8Encoding($false)))

Write-Output '--- 启动客户端，粘贴激活码 ---'
$shell = New-Object -ComObject WScript.Shell
Set-Clipboard -Value $code
$null = Start-Process -FilePath (Join-Path $Dir 'VideoMix.exe') -WorkingDirectory $Dir -PassThru
$window = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-ClientWindow
    if ($window) { break }
}
if (-not $window) { throw '等不到客户端窗口' }
Start-Sleep -Seconds 9
$null = $shell.AppActivate($window.Id)
Start-Sleep -Milliseconds 900

$box = New-Object RECT4
[void][UiHelp]::GetWindowRect($window.MainWindowHandle, [ref]$box)
$left = $box.Left; $top = $box.Top
$width = $box.Right - $box.Left; $height = $box.Bottom - $box.Top

Click-At ($left + [int]($width * 0.5)) ($top + [int]($height * 0.535))
Start-Sleep -Milliseconds 400
$shell.SendKeys('^a')
Start-Sleep -Milliseconds 200
$shell.SendKeys('{DEL}')
Start-Sleep -Milliseconds 200
Set-Clipboard -Value $code
Start-Sleep -Milliseconds 200
$shell.SendKeys('^v')
Start-Sleep -Milliseconds 800
Click-At ($left + [int]($width * 0.5)) ($top + [int]($height * 0.618))

$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $ticketFile) { $ok = $true; break }
}
Write-Output ("  授权票据已缓存：{0}" -f $ok)

$window.Refresh()
Start-Sleep -Seconds 10
Write-Output ("  本次会话窗口标题：{0}" -f $window.MainWindowTitle)
Save-Shot $window $OutMain

Write-Output '--- 重启客户端（预期：停在激活页，激活码已自动带出）---'
Stop-Clients
$null = Start-Process -FilePath (Join-Path $Dir 'VideoMix.exe') -WorkingDirectory $Dir -PassThru
$window = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-ClientWindow
    if ($window) { break }
}
if (-not $window) { throw '重启后等不到窗口' }
Start-Sleep -Seconds 25
$window.Refresh()
Write-Output ("  窗口标题：{0}" -f $window.MainWindowTitle)
Save-Shot $window $OutRestart

if (Test-Path -LiteralPath $clientLog) {
    Write-Output '--- license-client.log ---'
    Get-Content -LiteralPath $clientLog | ForEach-Object { Write-Output ("  " + $_) }
}

if (-not $Keep) {
    Stop-Clients
    if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
}
Write-Output '完成'
