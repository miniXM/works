#requires -version 7
# 升级完成后再启动一次客户端，确认它会向后台汇报新版本号（后台的“客户版本分布”靠这个）。
param(
    [string]$Work = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\upde2e',
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild',
    [int]$Port = 8083
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$app = Join-Path $Work 'app'
$data = Join-Path $Work 'data'
$base = "http://127.0.0.1:$Port"

Get-Process videomix, VideoMix -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$web = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port", '--data-dir', "`"$data`"", '--signing-key', "`"$((Join-Path $Root 'keys\license-private.xml'))`"") `
    -WorkingDirectory $WebDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $data 'out2.log') -RedirectStandardError (Join-Path $data 'err2.log')
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { if ((Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3).ok) { break } } catch { }
}

$null = Start-Process -FilePath (Join-Path $app 'VideoMix.exe') -WorkingDirectory $app -PassThru
Write-Output '等客户端跑 30 秒，让它上报版本号…'
Start-Sleep -Seconds 30

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-RestMethod "$base/api/login" -Method Post -NoProxy -WebSession $session `
    -ContentType 'application/json' -Body (@{ username = 'admin'; password = 'admin123' } | ConvertTo-Json -Compress)
$clients = Invoke-RestMethod "$base/api/settings/client-update/clients" -NoProxy -WebSession $session
Write-Output ("版本分布：{0}" -f ($clients.data.distribution | ConvertTo-Json -Compress))
Write-Output ("共 {0} 台，未升级 {1} 台，已最新 {2} 台" -f $clients.data.total, $clients.data.outdated, $clients.data.upToDate)

$title = (Get-Process videomix -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle
Write-Output ("窗口标题：{0}" -f $title)

Get-Process videomix, VideoMix -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
