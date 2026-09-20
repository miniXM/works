#requires -version 7
# 端到端演练“发新版本”：装 1.1.2 → 后台发布 1.1.3（强制）→ 客户端自己升级 → 升级后还能正常打开。
param(
    [string]$Setup = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\JSVideoMix-Setup-1.0.0.exe',
    [string]$Work = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\upde2e',
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild',
    [int]$Port = 8083,
    [string]$NewVersion = '1.1.3'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$pwsh = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
$rebrand = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand'
$base = "http://127.0.0.1:$Port"
$stage = Join-Path $Work 'stage'
$app = Join-Path $Work 'app'
$data = Join-Path $Work 'data'
$pkg = Join-Path $Work 'pkg'
$log = Join-Path $app 'license-client.log'

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*Python312*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
if (Test-Path -LiteralPath $Work) { [System.IO.Directory]::Delete($Work, $true) }
New-Item -ItemType Directory -Force -Path $stage, $app, $data, $pkg | Out-Null

Write-Output '=== 1/6 安装 1.1.2 ==='
Copy-Item -LiteralPath $Setup -Destination (Join-Path $stage 'setup.exe') -Force
@(('dir=' + $app), 'desktop=0', 'launch=0') |
    Set-Content -LiteralPath (Join-Path $stage 'setup.ini') -Encoding UTF8
$installer = Start-Process -FilePath (Join-Path $stage 'setup.exe') -ArgumentList '/S' -Wait -PassThru
Write-Output ("安装退出码：{0}" -f $installer.ExitCode)

$local = @{ serverUrl = $base } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $app 'license-server.json'), $local,
    (New-Object System.Text.UTF8Encoding($false)))

Write-Output ''
Write-Output '=== 2/6 起一台干净的授权后台 ==='
$web = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port", '--data-dir', "`"$data`"", '--signing-key', "`"$((Join-Path $Root 'keys\license-private.xml'))`"") `
    -WorkingDirectory $WebDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $data 'out.log') -RedirectStandardError (Join-Path $data 'err.log')
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { if ((Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3).ok) { break } } catch { }
}
Write-Output ("后台已启动：{0}" -f (Invoke-RestMethod "$base/health" -NoProxy).ok)

Write-Output ''
Write-Output '=== 3/6 造一个 ' + $NewVersion + ' 的更新包（启动器 + 改过的 app.asar）==='
$launcher = Join-Path $pkg 'VideoMix.exe'
& $pwsh -NoProfile -File (Join-Path $Root 'build-launcher.ps1') -Version $NewVersion -Out $launcher
$pkgResources = Join-Path $pkg 'videomix\resources'
New-Item -ItemType Directory -Force -Path $pkgResources | Out-Null
$rules = Join-Path $Work 'rules.json'
'{"text":[["极速混剪","极速混剪 1.1.3"]],"images":{}}' |
    Set-Content -LiteralPath $rules -Encoding UTF8
& $py (Join-Path $rebrand 'build_asar.py') `
    --base (Join-Path $app 'videomix\resources\app.asar') `
    --rules $rules --out (Join-Path $pkgResources 'app.asar')
$zip = Join-Path $Work ("update-client-{0}.zip" -f $NewVersion)
& $pwsh -NoProfile -File (Join-Path $Root 'build-client-update.ps1') -Version $NewVersion -Dir $pkg -Out $zip

Write-Output ''
Write-Output '=== 4/6 登录后台，上传并发布（强制更新）==='
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-RestMethod "$base/api/login" -Method Post -NoProxy -WebSession $session `
    -ContentType 'application/json' -Body (@{ username = 'admin'; password = 'admin123' } | ConvertTo-Json -Compress)
$upload = Invoke-RestMethod "$base/api/settings/client-update/upload?version=$NewVersion" -Method Post `
    -InFile $zip -ContentType 'application/octet-stream' -WebSession $session -NoProxy -TimeoutSec 120
Write-Output ("上传：{0}" -f $upload.message)
$publish = Invoke-RestMethod "$base/api/settings/client-update" -Method Post -NoProxy -WebSession $session `
    -ContentType 'application/json' `
    -Body (@{ action = 'publish'; force = $true; notes = '端到端演练' } | ConvertTo-Json -Compress)
Write-Output ("发布：{0}" -f $publish.message)

Write-Output ''
Write-Output '=== 5/6 启动 1.1.2 客户端，等它自己升级 ==='
# 静默升级模式（安装目录里放 auto-update.txt），免得卡在“要不要更新”的弹窗上
Set-Content -LiteralPath (Join-Path $app 'auto-update.txt') -Value 'delay=3' -Encoding UTF8
$null = Start-Process -FilePath (Join-Path $app 'VideoMix.exe') -WorkingDirectory $app -PassThru
$applied = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    if ((Test-Path -LiteralPath $log) -and
        (Select-String -Path $log -Pattern ("已安装更新 v" + [regex]::Escape($NewVersion)) -Quiet)) {
        $applied = $true
        break
    }
}
Write-Output ("升级已落地：{0}" -f $applied)

Write-Output ''
Write-Output '=== 6/6 升级后还能不能正常打开 ==='
$window = $null
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($window) { break }
}
Write-Output ("窗口标题：{0}" -f $(if ($window) { $window.MainWindowTitle } else { '（没出窗口）' }))

$clients = Invoke-RestMethod "$base/api/settings/client-update/clients" -NoProxy -WebSession $session
Write-Output ("后台看到的版本分布：{0}" -f (($clients.data.distribution | ConvertTo-Json -Compress)))
Write-Output ("共 {0} 台，未升级 {1} 台" -f $clients.data.total, $clients.data.outdated)

Write-Output ''
Write-Output '--- 客户端日志 ---'
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 16 -Encoding UTF8 }

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
