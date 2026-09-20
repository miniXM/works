#requires -version 7
# 把沙盒里的客户端用调试端口拉起来，改界面时反复用。
#
# 两种起法：
#   -Mode proxy     （默认）用 probe\proxy8081.py 顶替启动器的本机代理，
#                    自己开一张激活码，直接以 videomix\videomix.exe + 调试端口启动。
#                    改界面时用这个：能连 CDP，激活也是自动的。
#   -Mode launcher  走真正的启动器 VideoMix.exe（看不到界面内部，只用来肉眼验收）。
param(
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat',
    [int]$Cdpport = 9222,
    [int]$ServerPort = 8082,
    [string]$Mode = 'proxy',
    [string]$CodeName = '界面改造',
    [switch]$Sync
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$app = Join-Path $Root 'work\uitest\app'
if (-not (Test-Path -LiteralPath (Join-Path $app 'VideoMix.exe'))) {
    throw "沙盒还没准备好：$app"
}
$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$probe = Join-Path $Root 'work\rebrand\probe'

$local = @{ serverUrl = "http://127.0.0.1:$ServerPort" } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $app 'license-server.json'), $local,
    (New-Object System.Text.UTF8Encoding($false)))

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix', 'videomix-clone')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

if ($Sync) {
    # 把刚重建好的 app.asar / videomix.exe 拷进沙盒（必须等旧进程退干净，否则文件被占用）
    $out = Join-Path $Root 'work\rebrand\build\out'
    if (-not (Test-Path -LiteralPath (Join-Path $out 'app.asar'))) {
        throw "先跑 quick-asar.ps1 生成 $out\app.asar"
    }
    Copy-Item -LiteralPath (Join-Path $out 'app.asar') `
        -Destination (Join-Path $app 'videomix\resources\app.asar') -Force
    Copy-Item -LiteralPath (Join-Path $out 'videomix.exe') `
        -Destination (Join-Path $app 'videomix\videomix.exe') -Force
    Write-Output '已同步最新 app.asar + videomix.exe 到沙盒'
}

if ($Mode -eq 'launcher') {
    $null = Start-Process -FilePath (Join-Path $app 'VideoMix.exe') `
        -WorkingDirectory $app -PassThru
} else {
    $health = $null
    try { $health = Invoke-RestMethod "http://127.0.0.1:$ServerPort/health" -NoProxy -TimeoutSec 5 } catch { }
    if (-not $health) { throw "授权后台没在 127.0.0.1:$ServerPort 上跑" }

    $code = (& $py (Join-Path $probe 'make-code.py') --port $ServerPort --name $CodeName).Trim()
    Write-Output ("激活码：{0}" -f $code)

    $proxyArgs = @("`"$(Join-Path $probe 'proxy8081.py')`"", '--port', '8081',
                   '--server', "$ServerPort", '--code', $code) -join ' '
    $null = Start-Process -FilePath $py -ArgumentList $proxyArgs -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $probe 'gap\proxy.out.log') `
        -RedirectStandardError (Join-Path $probe 'gap\proxy.err.log')
    Start-Sleep -Seconds 2
    if (-not (Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue)) {
        throw '8081 代理没起来，看 probe\gap\proxy.err.log'
    }
    Write-Output '本机代理 8081 已就绪'

    $null = Start-Process -FilePath (Join-Path $app 'videomix\videomix.exe') `
        -ArgumentList "--remote-debugging-port=$Cdpport" `
        -WorkingDirectory (Join-Path $app 'videomix') -PassThru `
        -RedirectStandardOutput (Join-Path $probe 'gap\client.out.log') `
        -RedirectStandardError (Join-Path $probe 'gap\client.err.log')
}

$window = $null
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($window) { break }
}
Write-Output ("窗口：{0}" -f ($(if ($window) { "PID $($window.Id) 『$($window.MainWindowTitle)』" } else { '没有起来' })))

if ($Mode -eq 'launcher') {
    Write-Output '（启动器模式不带调试端口，肉眼看窗口就行）'
    return
}

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$Cdpport/json/version" -NoProxy -TimeoutSec 2 -UseBasicParsing
        if ($r.StatusCode -eq 200) { Write-Output "调试端口 $Cdpport 已就绪"; break }
    } catch { }
}
