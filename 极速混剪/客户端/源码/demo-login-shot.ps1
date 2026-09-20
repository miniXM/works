#requires -version 7
# 演示用：起测试后台 → 生成一个激活码 → 启动换过品牌的客户端 → 在登录框里输入激活码
# → 截图“激活成功后的主界面”（左侧 logo、顶部品牌名都在这一屏）。
param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$SignKey = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\keys\license-private.xml',
    [string]$DataDir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\verify\data',
    [int]$Port = 8082
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$base = "http://127.0.0.1:$Port"

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$web = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port", '--data-dir', "`"$DataDir`"", '--signing-key', "`"$SignKey`"") `
    -WorkingDirectory $WebDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $DataDir 'out.log') -RedirectStandardError (Join-Path $DataDir 'err.log')
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { if ((Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3).ok) { break } } catch { }
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$headers = @{ 'Content-Type' = 'application/json' }
$null = Invoke-RestMethod "$base/api/login" -Method Post -NoProxy -WebSession $session `
    -ContentType 'application/json' -Body (@{ username = 'admin'; password = 'admin123' } | ConvertTo-Json -Compress)
$batch = Invoke-RestMethod "$base/api/batches" -Method Post -NoProxy -WebSession $session `
    -ContentType 'application/json' -Body (@{ name = '演示截图'; quantity = 1; days = 365; maxDevices = 1 } | ConvertTo-Json -Compress)
$codes = Invoke-RestMethod "$base/api/codes?batchId=$($batch.id)" -NoProxy -WebSession $session
$code = $codes.data[0].code
Write-Output "激活码：$code"

$launcher = Join-Path $Dir 'VideoMix.exe'
$null = Start-Process -FilePath $launcher -WorkingDirectory $Dir -PassThru

$window = $null
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($window) { break }
}
if (-not $window) { throw '等不到客户端窗口' }
Start-Sleep -Seconds 8

$shell = New-Object -ComObject WScript.Shell
$null = $shell.AppActivate($window.Id)
Start-Sleep -Milliseconds 800
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32Click {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT3 rect);
}
public struct RECT3 { public int Left, Top, Right, Bottom; }
'@

function Click-At([int]$x, [int]$y) {
    [void][Win32Click]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 250
    [Win32Click]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [Win32Click]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 250
}

$box = New-Object RECT3
[void][Win32Click]::GetWindowRect($window.MainWindowHandle, [ref]$box)
$left = $box.Left
$top = $box.Top
$width = $box.Right - $box.Left
$height = $box.Bottom - $box.Top

# 先点一下激活码输入框，让焦点落在里面，再逐字输入
Click-At ($left + [int]($width * 0.5)) ($top + [int]($height * 0.54))
foreach ($char in $code.ToCharArray()) {
    $shell.SendKeys([string]$char)
    Start-Sleep -Milliseconds 120
}
Start-Sleep -Milliseconds 500
Click-At ($left + [int]($width * 0.5)) ($top + [int]($height * 0.62))
Write-Output "已输入激活码并点击登录（窗口 $left,$top - $($box.Right),$($box.Bottom)）"
Start-Sleep -Seconds 12

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT2 { public int Left, Top, Right, Bottom; }
public static class Win32Shot {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT2 rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$window.Refresh()
$handle = $window.MainWindowHandle
[void][Win32Shot]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 900
$rect = New-Object RECT2
[void][Win32Shot]::GetWindowRect($handle, [ref]$rect)
$bitmap = New-Object System.Drawing.Bitmap(($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
Write-Output ("窗口标题：{0}" -f $window.MainWindowTitle)
Write-Output ("截图：{0}" -f $Out)
