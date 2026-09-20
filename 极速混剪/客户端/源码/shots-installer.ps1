#requires -version 7
# 打开安装包界面（不点安装），截一张安装向导的图。
param(
    [string]$Setup = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\JSVideoMix-Setup-1.0.0.exe',
    [string]$Out = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\截图\9-安装向导-极速VideoMix.png'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECTI { public int Left, Top, Right, Bottom; }
public static class WinInst {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECTI rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$name = [System.IO.Path]::GetFileNameWithoutExtension($Setup)
Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

$proc = Start-Process -FilePath $Setup -PassThru
$window = $null
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne 0) { $window = $proc; break }
}
if (-not $window) { throw '等不到安装向导窗口' }
Start-Sleep -Seconds 3
[void][WinInst]::SetForegroundWindow($window.MainWindowHandle)
Start-Sleep -Milliseconds 900

$rect = New-Object RECTI
[void][WinInst]::GetWindowRect($window.MainWindowHandle, [ref]$rect)
$bitmap = New-Object System.Drawing.Bitmap(($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()

Write-Output ("窗口标题：{0}" -f $window.MainWindowTitle)
Write-Output ("截图：{0}" -f $Out)
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
