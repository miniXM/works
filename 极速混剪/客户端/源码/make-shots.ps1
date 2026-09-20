#requires -version 7
# 用新品牌安装包装一份到临时目录，截两张图：首次启动的设备激活页、激活成功后的主界面。
param(
    [string]$Setup = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\JSVideoMix-Setup-1.0.0.exe',
    [string]$Work = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\shots',
    [string]$Shots = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\截图',
    [string]$Rebrand = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand',
    [int]$Port = 8082
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$stage = Join-Path $Work 'stage'
$install = Join-Path $Work 'app'
if (Test-Path -LiteralPath $Work) { [System.IO.Directory]::Delete($Work, $true) }
New-Item -ItemType Directory -Force -Path $stage, $install | Out-Null

Copy-Item -LiteralPath $Setup -Destination (Join-Path $stage 'setup.exe') -Force
@(('dir=' + $install), 'desktop=0', 'launch=0') |
    Set-Content -LiteralPath (Join-Path $stage 'setup.ini') -Encoding UTF8
$installer = Start-Process -FilePath (Join-Path $stage 'setup.exe') -ArgumentList '/S' -Wait -PassThru
Write-Output ("安装退出码：{0}" -f $installer.ExitCode)

$local = @{ serverUrl = "http://127.0.0.1:$Port" } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $install 'license-server.json'), $local,
    (New-Object System.Text.UTF8Encoding($false)))

Write-Output '--- 截图 1：首次启动的设备激活页 ---'
& (Join-Path $Rebrand 'capture-window.ps1') -Dir $install `
    -Out (Join-Path $Shots '6-首次启动-设备激活-极速VideoMix.png')
foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Write-Output '--- 截图 2：激活成功后的主界面 ---'
& (Join-Path $Rebrand 'demo-login-shot.ps1') -Dir $install `
    -Out (Join-Path $Shots '7-激活成功-主界面-极速VideoMix.png') `
    -DataDir (Join-Path $Work 'data') -Port $Port
foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*Python312*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output '截图完成'
