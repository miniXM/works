#requires -version 7
# 把本次任务的全部材料打成三个包，方便换电脑继续做。
param(
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat',
    [string]$OutDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\备份'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$stamp = Get-Date -Format 'yyyyMMdd'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ---------- 包 A：源码 / 脚本 / 后台 / 密钥 / 文档 / 截图 ----------
$listA = New-Object System.Collections.Generic.List[string]
function AddFile($relative) {
    $full = Join-Path $Root $relative
    if (Test-Path -LiteralPath $full -PathType Leaf) { $listA.Add($relative) }
}
function AddDir($relative, [string[]]$patterns, [string[]]$excludeDirs = @()) {
    $full = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $full)) { return }
    $files = Get-ChildItem -LiteralPath $full -Recurse -File -Force -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($Root.Length + 1).Replace('\', '/')
        $skip = $false
        foreach ($x in $excludeDirs) { if ($rel -like "$x*") { $skip = $true; break } }
        if ($skip) { continue }
        if ($patterns.Count -eq 0 -or ($patterns | Where-Object { $f.Name -like $_ })) { $listA.Add($rel) }
    }
}

# rebrand：脚本和配置（不含测试 Key、不含 __pycache__）
AddDir 'work/rebrand' @('*.py', '*.ps1', '*.json', '*.md', '*.txt', '*.log', '*.sed') @(
    'work/rebrand/__pycache__/', 'work/rebrand/test-keys.local.json')
AddDir 'work/rebrand/assets' @() @()
AddDir 'work/rebrand/mainui' @() @()
AddDir 'work/rebrand/base-asardist' @() @()
AddDir 'work/rebrand/probe' @('*.py', '*.ps1', '*.txt') @()

# videomix-rebuild：启动器源码、编译脚本、密钥、报告
AddDir 'work/videomix-rebuild/sfx' @() @()
AddDir 'work/videomix-rebuild/keys' @() @()
AddDir 'work/videomix-rebuild/licenseserver' @() @()
AddDir 'work/videomix-rebuild/asar' @() @()
AddDir 'work/videomix-rebuild/evidence' @() @()
AddDir 'work/videomix-rebuild/cstest' @() @()
AddDir 'work/videomix-rebuild/ls-test' @() @()
AddDir 'work/videomix-rebuild/notes' @() @()
AddDir 'work/videomix-rebuild/report' @() @()
foreach ($name in @('build-client-update.ps1', 'build-launcher.ps1', 'build-licenseserver.ps1',
                    'build-setup.ps1', 'client-version.txt', 'default-server.txt', 'installer.sed',
                    'probe-license.ps1', 'README.md', 'run-e2e2.ps1', 'scan-endpoints.py',
                    'scope.md', 'test-license.ps1', 'timeline.md', 'update-payload-entry.ps1',
                    'workitems.md')) { AddFile "work/videomix-rebuild/$name" }

# 网页版授权后台（含部署包、数据、截图）
AddDir 'outputs/videomix-web' @() @()

# 交付文档与截图
AddDir 'outputs/videomix-rebuild/截图' @() @()
AddDir 'outputs/videomix-rebuild' @('*.md') @('outputs/videomix-rebuild/旧版本-未换品牌/')
AddFile 'outputs/videomix-rebuild/VideoMix-LicenseServer.exe'

$listAPath = Join-Path $env:TEMP 'vm-backup-a.txt'
$listA | Sort-Object -Unique | Set-Content -LiteralPath $listAPath -Encoding UTF8
Write-Output ("包 A 收录 {0} 个文件" -f ($listA | Sort-Object -Unique).Count)

# ---------- 打包 ----------
function MakeZip([string]$name, [string[]]$items, [string]$listFile) {
    $zip = Join-Path $OutDir $name
    if (Test-Path -LiteralPath $zip) { [System.IO.File]::Delete($zip) }
    if ($listFile) {
        & tar.exe -a -c -f $zip -C $Root -T $listFile
    } else {
        & tar.exe -a -c -f $zip -C $Root @items
    }
    if ($LASTEXITCODE -ne 0) { throw "打包失败：$name" }
    $size = (Get-Item -LiteralPath $zip).Length / 1MB
    $sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    Write-Output ("{0}  {1:N1} MB  SHA256 {2}" -f $name, $size, $sha)
}

Write-Output ''
Write-Output '=== 包 A：源码脚本 + 授权后台 + 密钥 + 文档 ==='
MakeZip ("VideoMix-任务备份-源码脚本-{0}.zip" -f $stamp) @() $listAPath

Write-Output ''
Write-Output '=== 包 B：重建素材（重新出包必需） ==='
MakeZip ("VideoMix-任务备份-重建素材-{0}.zip" -f $stamp) @('work/rebrand/base')

Write-Output ''
Write-Output '=== 包 C：成品安装包 ==='
MakeZip ("VideoMix-任务备份-成品安装包-{0}.zip" -f $stamp) @('outputs/videomix-rebuild')

Write-Output ''
Write-Output '__RUN_END__'
