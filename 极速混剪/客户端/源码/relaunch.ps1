#requires -version 7
# 把刚重建好的 app.asar / videomix.exe 同步进沙盒并重开客户端（带调试端口）。
# 跟 ui-run.ps1 -Sync 做同一件事，但用 Start-Process 甩出去，不会把调用方挂住。
param(
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat',
    [int]$Cdpport = 9222,
    [int]$ServerPort = 8083,
    [string]$CodeName = '界面改造'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$app = Join-Path $Root 'work\uitest\app'
$out = Join-Path $Root 'work\rebrand\build\out'
$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$probe = Join-Path $Root 'work\rebrand\probe'

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix', 'videomix-clone')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Copy-Item -LiteralPath (Join-Path $out 'app.asar') `
    -Destination (Join-Path $app 'videomix\resources\app.asar') -Force
Copy-Item -LiteralPath (Join-Path $out 'videomix.exe') `
    -Destination (Join-Path $app 'videomix\videomix.exe') -Force
Write-Output '已同步 app.asar + videomix.exe'

$local = @{ serverUrl = "http://127.0.0.1:$ServerPort" } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $app 'license-server.json'), $local,
    (New-Object System.Text.UTF8Encoding($false)))

$health = $null
try { $health = Invoke-RestMethod "http://127.0.0.1:$ServerPort/health" -NoProxy -TimeoutSec 5 } catch { }
if (-not $health) { throw "授权后台没在 127.0.0.1:$ServerPort 上跑" }

$code = (& $py (Join-Path $probe 'make-code.py') --port $ServerPort --name $CodeName).Trim()
Write-Output ("激活码：{0}" -f $code)

$proxyArgs = @("`"$(Join-Path $probe 'proxy8081.py')`"", '--port', '8081',
               '--server', "$ServerPort", '--code', $code) -join ' '
Start-Process -FilePath $py -ArgumentList $proxyArgs -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $probe 'gap\proxy.out.log') `
    -RedirectStandardError (Join-Path $probe 'gap\proxy.err.log') | Out-Null
Start-Sleep -Seconds 2

Start-Process -FilePath (Join-Path $app 'videomix\videomix.exe') `
    -ArgumentList "--remote-debugging-port=$Cdpport" `
    -WorkingDirectory (Join-Path $app 'videomix') `
    -RedirectStandardOutput (Join-Path $probe 'gap\client.out.log') `
    -RedirectStandardError (Join-Path $probe 'gap\client.err.log') | Out-Null

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($window) { Write-Output ("窗口：PID {0} 『{1}』" -f $window.Id, $window.MainWindowTitle); break }
}
Write-Output '完成'
