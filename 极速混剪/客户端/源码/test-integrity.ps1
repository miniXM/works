#requires -version 7
# 验证：在线升级只换 app.asar（不动 videomix\videomix.exe）时，客户端还能不能启动。
#   1) 装一份干净客户端，先启动一次做基线
#   2) 用 build_asar.py 生成“内容不同”的 app.asar，直接覆盖进去（模拟只换 asar 的更新）
#   3) 再启动一次，看是正常出窗口还是被 Electron 的完整性校验挡掉
param(
    [string]$Setup = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\JSVideoMix-Setup-1.0.0.exe',
    [string]$Work = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\updatetest'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$rebrand = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand'
$stage = Join-Path $Work 'stage'
$app = Join-Path $Work 'app'

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $Work) { [System.IO.Directory]::Delete($Work, $true) }
New-Item -ItemType Directory -Force -Path $stage, $app | Out-Null

Write-Output '--- 安装一份干净客户端 ---'
Copy-Item -LiteralPath $Setup -Destination (Join-Path $stage 'setup.exe') -Force
@(('dir=' + $app), 'desktop=0', 'launch=0') |
    Set-Content -LiteralPath (Join-Path $stage 'setup.ini') -Encoding UTF8
$installer = Start-Process -FilePath (Join-Path $stage 'setup.exe') -ArgumentList '/S' -Wait -PassThru
Write-Output ("安装退出码：{0}" -f $installer.ExitCode)

function Test-Launch([string]$label) {
    foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
        Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    # 跟客户一样从启动器进入（启动器负责补 app.asar 的完整性哈希）
    $null = Start-Process -FilePath (Join-Path $app 'VideoMix.exe') -WorkingDirectory $app -PassThru
    $window = $null
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $window = Get-Process videomix -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($window) { break }
    }
    $alive = Get-Process videomix -ErrorAction SilentlyContinue
    Write-Output ("{0}：出窗口={1}  videomix 进程存活={2}" -f $label, [string][bool]$window, [string][bool]$alive)
    $script:lastLaunchOk = [bool]$window
}

Write-Output ''
Write-Output '--- 基线：原样启动 ---'
Test-Launch '基线'
$baseline = $script:lastLaunchOk

Write-Output ''
Write-Output '--- 生成一个内容不同的 app.asar（模拟只换 asar 的更新包）---'
$asar = Join-Path $app 'videomix\resources\app.asar'
$rules = Join-Path $Work 'rules.json'
'{"text":[["极速混剪","极速混剪1"]],"images":{}}' |
    Set-Content -LiteralPath $rules -Encoding UTF8
$newAsar = Join-Path $Work 'app-new.asar'
& $py (Join-Path $rebrand 'build_asar.py') --base $asar --rules $rules --out $newAsar
$before = (Get-Item -LiteralPath $asar).Length
Copy-Item -LiteralPath $newAsar -Destination $asar -Force
Write-Output ("新 asar：{0} 字节（原 {1} 字节）" -f (Get-Item -LiteralPath $asar).Length, $before)

Write-Output ''
Write-Output '--- 只换 asar 之后再启动 ---'
Test-Launch '换完 asar'
$after = $script:lastLaunchOk

Write-Output ''
Write-Output ("结论：基线={0}  换 asar 后={1}" -f $baseline, $after)
Write-Output '--- 客户端日志（如果有）---'
$log = Join-Path $app 'license-client.log'
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 10 -Encoding UTF8 }

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
