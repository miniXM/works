#requires -version 7
# 在真实安装出来的目录上验证“退出再启动”的行为：
#   1) 先清掉 Chromium 本地存储（模拟“激活完立刻关软件、写入还没落盘”）
#   2) 启动客户端 -> 截图（预期：停在激活页，激活码已由本机代理兜底带出）
#   3) 直接问本机代理 GET /vm/license，确认它手里有激活码
param(
    [string]$AppDir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\verify\app',
    [string]$DataDir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\verify\data',
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$SignKey = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\keys\license-private.xml',
    [string]$Shot = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\verify\restart-after-activation.png',
    [int]$Port = 8082
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$base = "http://127.0.0.1:$Port"
$proxy = 'http://127.0.0.1:8081'
$roaming = Join-Path $env:APPDATA 'videomix'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class UiHelp2 {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT5 r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
public struct RECT5 { public int Left, Top, Right, Bottom; }
'@

function Stop-Clients {
    foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
        Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Save-Shot($window, [string]$path) {
    [void][UiHelp2]::SetForegroundWindow($window.MainWindowHandle)
    Start-Sleep -Milliseconds 900
    $rect = New-Object RECT5
    [void][UiHelp2]::GetWindowRect($window.MainWindowHandle, [ref]$rect)
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

Write-Output '--- 清掉 Chromium 本地存储（模拟写入还没落盘）---'
foreach ($dir in @('Local Storage', 'Session Storage')) {
    $full = Join-Path $roaming $dir
    if (Test-Path -LiteralPath $full) {
        [System.IO.Directory]::Delete($full, $true)
        Write-Output ("  删除 {0}" -f $full)
    }
}
$ticket = Join-Path $AppDir 'license-ticket.json'
Write-Output ("  安装目录里的票据：{0}（{1} 字节）" -f (Test-Path -LiteralPath $ticket), (Get-Item -LiteralPath $ticket -ErrorAction SilentlyContinue).Length)

Write-Output ''
Write-Output '--- 启动测试后台 ---'
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty OwningProcess |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
$web = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port", '--data-dir', "`"$DataDir`"", '--signing-key', "`"$SignKey`"") `
    -WorkingDirectory $WebDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $DataDir 'out2.log') -RedirectStandardError (Join-Path $DataDir 'err2.log')
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { if ((Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3).ok) { $ready = $true; break } } catch { }
}
Write-Output ("  后台已启动：{0}" -f $ready)

Write-Output ''
Write-Output '--- 启动客户端（本地存储是空的，只能靠本机代理兜底）---'
$null = Start-Process -FilePath (Join-Path $AppDir 'VideoMix.exe') -WorkingDirectory $AppDir -PassThru
$window = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($window) { break }
}
if (-not $window) { throw '等不到客户端窗口' }
Start-Sleep -Seconds 22
$window.Refresh()
Write-Output ("  窗口标题：{0}" -f $window.MainWindowTitle)
Save-Shot $window $Shot

Write-Output ''
Write-Output '--- 问本机代理要激活码 ---'
try {
    $lic = Invoke-RestMethod "$proxy/vm/license" -NoProxy -TimeoutSec 5
    Write-Output ("  object={0}  activateCode={1}  expiresAt={2}" -f $lic.object, $lic.data.activateCode, $lic.data.expiresAt)
} catch {
    Write-Output ("  取不到：{0}" -f $_.Exception.Message)
}

Stop-Clients
if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
Write-Output '完成'
