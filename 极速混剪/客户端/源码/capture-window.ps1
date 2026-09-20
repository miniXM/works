#requires -version 7
# 启动指定安装目录的客户端，等窗口出来，截一张图。
param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Wait = 25
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800

$launcher = Join-Path $Dir 'VideoMix.exe'
$null = Start-Process -FilePath $launcher -WorkingDirectory $Dir -PassThru

$window = $null
for ($i = 0; $i -lt ($Wait * 2); $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($window) { break }
}
if (-not $window) { throw '等不到客户端窗口' }
Start-Sleep -Seconds 6      # 让页面渲染完

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public static class Win32 {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$handle = $window.MainWindowHandle
[void][Win32]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 800

$rect = New-Object RECT
[void][Win32]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output ("窗口标题：{0}" -f $window.MainWindowTitle)
Write-Output ("截图：{0}（{1}×{2}）" -f $Out, $width, $height)
