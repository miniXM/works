#requires -version 7
# 把已经在运行的客户端窗口提到最前并截图（不重新启动任何东西）。
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$ProcessName = 'videomix'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECTF { public int Left, Top, Right, Bottom; }
public static class WinFront {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECTF rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@

$win = Get-Process $ProcessName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $win) { throw "没有正在运行的 $ProcessName 窗口" }

$handle = $win.MainWindowHandle
if ([WinFront]::IsIconic($handle)) { [void][WinFront]::ShowWindow($handle, 9) }
[void][WinFront]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 1200

$rect = New-Object RECTF
[void][WinFront]::GetWindowRect($handle, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap($w, $h)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
Write-Output ("窗口『{0}』标题『{1}』 -> {2}（{3}×{4}）" -f $win.ProcessName, $win.MainWindowTitle, $Out, $w, $h)
