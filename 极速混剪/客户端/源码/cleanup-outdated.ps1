#requires -version 7
# 清理过时文件与中间产物。
#
# 只删两类东西：
#   1) 出包/测试过程中生成的中间产物，随时能用脚本重新生成
#   2) 已经被 1.0.0 取代的旧成品（备份包里另有一份）
# 一律保留：出包必需的 base、脚本、密钥、网页后台、文档、截图、后台数据。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = 'E:\GPT Codex\2026-09-15\new-chat'

# 目录（递归删）
$dirs = @(
    'work\rebrand\__pycache__',
    'work\rebrand\build',
    'work\rebrand\shots',
    'work\rebrand\shots-preview',
    'work\rebrand\tmp',
    'work\rebrand\test',
    'work\rebrand\verify',
    'work\rebrand\probe\__pycache__',
    'work\rebrand\probe\base',
    'work\asar-inspect',
    'work\backup-extract',
    'work\backup-restore',
    'work\backup-test',
    'work\deploy-test',
    'work\master-route-20260915-170427',
    'work\pip-tmp',
    'work\probe-duration',
    'work\update-e2e',
    'work\update-test',
    'work\zipcheck',
    'outputs\videomix-rebuild\旧版本-未换品牌'
)

# 单个文件
$files = @(
    'work\videomix-rebuild\stage-payload-6.zip',
    'work\videomix-rebuild\app.patched.asar',
    'work\rebrand\test-demo\SparkCut-Setup-1.2.0.exe',
    'outputs\videomix-rebuild\JSVideoMix-Setup-1.1.2.exe',
    'work\backup-test-query.py',
    'work\backup-test-selfcheck.py',
    'work\extract_asar.py',
    'work\inspect_brand.py',
    'work\patch_asar_v2.py',
    'work\patch_exe_brand.py',
    'work\patch_exe_integrity.py',
    'work\selfcheck-run.log',
    'work\web-demo.pid'
)

function Get-Size($path) {
    if (Test-Path -LiteralPath $path -PathType Container) {
        $s = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue |
              Measure-Object Length -Sum)
        return [int64]$s.Sum
    }
    return [int64](Get-Item -LiteralPath $path -Force).Length
}

# ---------- 删除前先校验：每个目标都必须落在工作区内 ----------
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
$plan = @()
foreach ($rel in ($dirs + $files)) {
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
    if (-not $full.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "目标不在工作区内，已中止：$full"
    }
    if ($full -eq $rootFull) { throw "目标是工作区根目录，已中止：$full" }
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $plan += [pscustomobject]@{ Path = $full; IsDir = (Test-Path -LiteralPath $full -PathType Container) }
}

$totalBefore = 0
Write-Output '将删除以下内容：'
foreach ($item in $plan) {
    $size = Get-Size $item.Path
    $totalBefore += $size
    Write-Output ("  {0,10:N1} MB  {1}" -f ($size / 1MB), $item.Path.Substring($rootFull.Length + 1))
}
Write-Output ("合计 {0:N2} GB" -f ($totalBefore / 1GB))
Write-Output ''

# ---------- 执行删除 ----------
foreach ($item in $plan) {
    try {
        if ($item.IsDir) {
            [System.IO.Directory]::Delete($item.Path, $true)
        } else {
            [System.IO.File]::SetAttributes($item.Path, [System.IO.FileAttributes]::Normal)
            [System.IO.File]::Delete($item.Path)
        }
    } catch {
        Write-Output ("  删除失败：{0}  {1}" -f $item.Path, $_.Exception.Message)
    }
}

$left = 0
$fail = 0
foreach ($item in $plan) {
    if (Test-Path -LiteralPath $item.Path) { $fail++; Write-Output ("  仍存在：" + $item.Path) }
}
Write-Output ''
Write-Output ("已删除 {0} 项，释放 {1:N2} GB，残留 {2} 项" -f $plan.Count, ($totalBefore / 1GB), $fail)
Write-Output '__RUN_END__'
