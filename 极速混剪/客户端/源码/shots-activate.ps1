#requires -version 7
# 在已经装好的客户端上走一遍“输入激活码 -> 登录 -> 进主界面”，逐步截图。
param(
    [string]$Dir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\shots\app',
    [string]$OutDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\截图',
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$SignKey = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\keys\license-private.xml',
    [string]$DataDir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\shots\data',
    [int]$Port = 8082
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$base = "http://127.0.0.1:$Port"
$ticketFile = Join-Path $Dir 'license-ticket.json'

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800
if (Test-Path -LiteralPath $ticketFile) { Remove-Item -LiteralPath $ticketFile -Force }

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
    -ContentType 'application/json' -Body (@{ name = '品牌截图'; quantity = 1; days = 365; maxDevices = 1 } | ConvertTo-Json -Compress)
$code = (Invoke-RestMethod "$base/api/codes?batchId=$($batch.id)" -NoProxy -WebSession $session).data[0].code
Write-Output "激活码：$code"

Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECTS { public int Left, Top, Right, Bottom; }
public static class WinShot {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECTS rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@

function Get-ClientWindow {
    Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}
function Click-At([int]$x, [int]$y) {
    [void][WinShot]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 200
    [WinShot]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [WinShot]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
}
function Save-Shot($window, [string]$path) {
    [void][WinShot]::SetForegroundWindow($window.MainWindowHandle)
    Start-Sleep -Milliseconds 900
    $rect = New-Object RECTS
    [void][WinShot]::GetWindowRect($window.MainWindowHandle, [ref]$rect)
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap(($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
    Write-Output ("截图：{0}（{1}×{2}）" -f $path, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
}

$null = Start-Process -FilePath (Join-Path $Dir 'VideoMix.exe') -WorkingDirectory $Dir -PassThru
$window = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-ClientWindow
    if ($window) { break }
}
if (-not $window) { throw '等不到客户端窗口' }
Start-Sleep -Seconds 8
$window.Refresh()
Save-Shot $window (Join-Path $OutDir '6-首次启动-设备激活-极速VideoMix.png')

$rect = New-Object RECTS
[void][WinShot]::GetWindowRect($window.MainWindowHandle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

Set-Clipboard -Value $code
$shell = New-Object -ComObject WScript.Shell
$null = $shell.AppActivate($window.Id)
Start-Sleep -Milliseconds 600
Click-At ($rect.Left + [int]($width * 0.5)) ($rect.Top + [int]($height * 0.54))
Start-Sleep -Milliseconds 300
$shell.SendKeys('^a')
Start-Sleep -Milliseconds 200
$shell.SendKeys('^v')
Start-Sleep -Milliseconds 800
Save-Shot $window (Join-Path $OutDir '6b-已填激活码-待登录-极速VideoMix.png')

Click-At ($rect.Left + [int]($width * 0.5)) ($rect.Top + [int]($height * 0.617))
Write-Output '已点击登录，等授权代理写缓存…'
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $ticketFile) { $ok = $true; break }
}
Write-Output ("授权缓存已写入：{0}" -f $ok)
Start-Sleep -Seconds 12
$window.Refresh()
Save-Shot $window (Join-Path $OutDir '7-激活成功-主界面-极速VideoMix.png')

Write-Output '--- 重启一次，确认以后启动直接进主界面 ---'
foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$null = Start-Process -FilePath (Join-Path $Dir 'VideoMix.exe') -WorkingDirectory $Dir -PassThru
$window = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-ClientWindow
    if ($window) { break }
}
Start-Sleep -Seconds 15
Save-Shot $window (Join-Path $OutDir '8-再次启动-已激活-极速VideoMix.png')

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
Write-Output '完成'
