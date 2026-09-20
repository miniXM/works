#requires -version 7
# 端到端验证“客户端在线升级”：
#   装一份旧版（默认 1.0.0）→ 起一个独立的授权后台 → 上传并发布更新包（默认 1.0.1）
#   → 让客户端自动升级 → 校验安装目录里的启动器真的换成了新版本。
#
# 用法（在仓库根目录）：
#   pwsh -NoProfile -File work\rebrand\verify-update.ps1
#   pwsh -NoProfile -File work\rebrand\verify-update.ps1 -Setup <旧版安装包> -UpdateZip <更新包>
#
# 说明：
#   * 会停掉 8081（本机代理）上的进程，跑完请重新启动客户端。
#   * 用的是独立端口（默认 8090）和独立数据目录，不会碰到你正在跑的 8082 / 8083 后台。
#   * 客户端安装目录里放 auto-update.txt，走静默升级，不用手点弹窗。
param(
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat',
    [string]$Setup = '',
    [string]$UpdateZip = '',
    [string]$NewVersion = '1.0.1',
    [string]$OldVersion = '1.0.0',
    [int]$Port = 8090,
    [int]$WaitSeconds = 180
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$web = Join-Path $Root 'outputs\videomix-web'
$signKey = Join-Path $Root 'work\videomix-rebuild\keys\license-private.xml'
if (-not $Setup) { $Setup = Join-Path $Root 'outputs\videomix-rebuild\JSVideoMix-Setup-1.0.0.exe' }
if (-not $UpdateZip) { $UpdateZip = Join-Path $Root ("outputs\videomix-rebuild\update-client-{0}.zip" -f $NewVersion) }

$scratch = Join-Path $Root 'work\rebrand\updtest'
$stageDir = Join-Path $scratch 'stage'
$installDir = Join-Path $scratch 'app'
$dataDir = Join-Path $scratch 'data'
$base = "http://127.0.0.1:$Port"
$pass = 0
$fail = 0

function Check([string]$name, [string]$expected, [string]$actual) {
    if ($expected -eq $actual) {
        Write-Output ("PASS  {0}  -> {1}" -f $name, $actual)
        $script:pass++
    } else {
        Write-Output ("FAIL  {0}  期望={1} 实际={2}" -f $name, $expected, $actual)
        $script:fail++
    }
}

function Api {
    param($Method, $Path, $Body, $Session)
    $q = @{ Uri = "$base$Path"; Method = $Method; NoProxy = $true; SkipHttpErrorCheck = $true }
    if ($Session) { $q.WebSession = $Session }
    if ($null -ne $Body) {
        $q.ContentType = 'application/json'
        $q.Body = ($Body | ConvertTo-Json -Depth 6 -Compress)
    }
    (Invoke-WebRequest @q).Content | ConvertFrom-Json
}

function CheckContains([string]$name, [string]$needle, [string]$haystack) {
    Check $name 'True' ([string]($haystack -like "*$needle*"))
}

function FileVersionOf([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    return [string](Get-Item -LiteralPath $path).VersionInfo.FileVersion
}

foreach ($p in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
foreach ($busyPort in @(8081, $Port)) {
    Get-NetTCPConnection -LocalPort $busyPort -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

if (Test-Path -LiteralPath $scratch) { [System.IO.Directory]::Delete($scratch, $true) }
New-Item -ItemType Directory -Path $stageDir, $installDir, $dataDir -Force | Out-Null
Copy-Item -LiteralPath $Setup -Destination (Join-Path $stageDir 'setup.exe') -Force

Write-Output '--- 启动独立测试后台 ---'
$server = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port",
                    '--data-dir', "`"$dataDir`"", '--signing-key', "`"$signKey`"") `
    -WorkingDirectory $web -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDir 'out.log') `
    -RedirectStandardError (Join-Path $dataDir 'err.log')
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { $h = Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3; if ($h.ok) { $ready = $true; break } } catch { }
}
Check '测试后台已启动' 'True' ([string]$ready)

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Api POST '/api/login' @{ username = 'admin'; password = 'admin123' } $session

Write-Output ''
Write-Output '--- 静默安装旧版 ---'
@(('dir=' + $installDir), ("server=$base"), 'desktop=0', 'launch=0') |
    Set-Content -LiteralPath (Join-Path $stageDir 'setup.ini') -Encoding UTF8
$install = Start-Process -FilePath (Join-Path $stageDir 'setup.exe') -ArgumentList '/S' -Wait -PassThru
Check '安装程序退出码' '0' ([string]$install.ExitCode)
$installedExe = Join-Path $installDir 'VideoMix.exe'
Check '装好的启动器版本' $OldVersion (FileVersionOf $installedExe)
CheckContains '客户端指向测试后台' $base `
    (Get-Content -LiteralPath (Join-Path $installDir 'license-server.json') -Raw)

Write-Output ''
Write-Output '--- 上传并发布更新包 ---'
$zipItem = Get-Item -LiteralPath $UpdateZip
$upload = Invoke-WebRequest -Uri "$base/api/settings/client-update/upload?version=$NewVersion" `
    -Method POST -InFile $UpdateZip -ContentType 'application/octet-stream' `
    -WebSession $session -NoProxy -SkipHttpErrorCheck
$uploadBody = $upload.Content | ConvertFrom-Json
Check '更新包已上传' 'True' ([string]$uploadBody.success)
$publish = Api POST '/api/settings/client-update' @{ action = 'publish'; force = $true; notes = '端到端升级测试' } $session
Check '更新已发布' 'True' ([string]$publish.success)
Check '后台记录的版本号' $NewVersion ([string]$publish.data.version)
Check '后台记录的签名非空' 'True' ([string](-not [string]::IsNullOrWhiteSpace($publish.data.signature)))
Check '后台记录的 sha256 与文件一致' `
    (Get-FileHash -LiteralPath $UpdateZip -Algorithm SHA256).Hash.ToLower() `
    ([string]$publish.data.sha256).ToLower()

Write-Output ''
Write-Output '--- 启动客户端，等它自己升级 ---'
# 静默升级：不问直接更新，2 秒后开始检查
'delay=2' | Set-Content -LiteralPath (Join-Path $installDir 'auto-update.txt') -Encoding UTF8
# 把子进程的输出接到文件上：否则它会继承调用者的 stdout 句柄，
# 在 `pwsh -File ... | Select-Object` 这种管道里会把外层命令一直挂住。
$client = Start-Process -FilePath $installedExe -PassThru `
    -RedirectStandardOutput (Join-Path $scratch 'client.out.log') `
    -RedirectStandardError (Join-Path $scratch 'client.err.log')

$upgraded = $false
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if ((FileVersionOf $installedExe) -eq $NewVersion) { $upgraded = $true; break }
}
Check '升级后启动器版本' $NewVersion (FileVersionOf $installedExe)

$logPath = Join-Path $installDir 'license-client.log'
$logText = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw -Encoding UTF8 } else { '' }
Check '日志里有“已安装更新 v{0}”' 'True' `
    ([string]($logText -like ("*已安装更新 v" + $NewVersion + "*")))
Check '日志里有校验通过记录' 'True' `
    ([string]($logText -like ("*更新已下载并通过校验*v" + $NewVersion + "*")))

# 重启后的新启动器会再查一次版本，顺手把“本机现在跑的是哪个版本”报给后台；
# 这一步比换文件慢几秒，所以这里轮询等一会儿，别抢在它前面断言。
$reported = $false
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
    $clients = Api GET '/api/settings/client-update/clients' $null $session
    # 后台这个接口返回的是 data.clients（对象里再包一层列表），不是 data 本身。
    $hit = @(@($clients.data.clients) | Where-Object { "$($_.version)" -eq $NewVersion })
    if ($hit.Count -ge 1) { $reported = $true; break }
    Start-Sleep -Seconds 3
}
Check '后台看到客户端已上报新版本' 'True' ([string]$reported)

Write-Output ''
Write-Output ("RESULT pass={0} fail={1}" -f $pass, $fail)
Write-Output ("安装包：{0}（{1:N0} 字节）" -f $Setup, (Get-Item -LiteralPath $Setup).Length)
Write-Output ("更新包：{0}（{1:N0} 字节）" -f $UpdateZip, $zipItem.Length)
Write-Output ("测试后台 pid={0}  客户端 pid={1}  目录 {2}" -f $server.Id, $client.Id, $scratch)
Write-Output '测试后台还开着，想停掉：Stop-Process -Id <pid>'

if ($fail -gt 0) { exit 1 }
