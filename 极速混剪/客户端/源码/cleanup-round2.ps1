#requires -version 7
#
# 第二轮清理（2026-09-18）
#
# 只删两类东西：
#   1. work\rebrand\probe\ 下面的中间截图（*.png）和空档测试成片样张（*.mp4）
#      —— 交付用的精选图已经在 outputs\videomix-rebuild\截图\，这些是同一批流程的
#         过程图，需要时跑 probe\ 里保留的脚本可以再截一次。
#   2. work\rebrand\ 下面已经被 1.0.0 那轮日志取代的旧构建/验证日志
#      —— 保留 build-1.0.0.log / verify-1.0.0.log / smoke-rebuild.log / build-voice-dd.log /
#         verify-voice-dd.log / make-backup*.log / verify-backup.log / cleanup*.log。
#
# 每条都做路径越界校验，脚本可重复执行（第二次会跳过已删的）。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = 'E:\GPT Codex\2026-09-15\new-chat'
$log  = Join-Path $root 'work\rebrand\cleanup-round2.log'
$lines = [System.Collections.Generic.List[string]]::new()

function Note([string]$text) {
    $lines.Add($text)
    Write-Host $text
}

function Resolve-InRoot([string]$path) {
    $rootFull = [System.IO.Path]::GetFullPath($root)
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "路径越界，拒绝操作：$full"
    }
    return $full
}

$removed = 0
$freed = 0

Note "== 第二轮清理开始 =="

# ---------- 1. 探测阶段的中间图片 / 录像 ----------

$shots = @(
    @{ Dir = 'work\rebrand\probe'; Pattern = '*.png' }
    @{ Dir = 'work\rebrand\probe'; Pattern = '*.mp4' }
)

foreach ($s in $shots) {
    $dir = Resolve-InRoot (Join-Path $root $s.Dir)
    if (-not (Test-Path -LiteralPath $dir)) {
        Note "跳过（不存在）：$($s.Dir)"
        continue
    }
    $files = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Filter $s.Pattern)
    $bytes = 0
    foreach ($f in $files) {
        $bytes += $f.Length
        Remove-Item -LiteralPath $f.FullName -Force
    }
    $removed += $files.Count
    $freed += $bytes
    Note ("删除 {0,3} 个 {1}（{2:N1} MB）：{3}" -f $files.Count, $s.Pattern, ($bytes / 1MB), $s.Dir)
}

# ---------- 2. 被 1.0.0 那轮取代的旧日志 ----------

$oldLogs = @(
    'build-branded.log'
    'build-gap.log'
    'build-persona.log'
    'build-persona-ask4.log'
    'build-persona-pack.log'
    'build-persona-seed.log'
    'build-voice-hint.log'
    'quick-voice.log'
    'quick-voice2.log'
    'make-shots.log'
    'shots-activate.log'
    'test-integrity.log'
    'test-update-e2e.log'
    'verify-branded.log'
    'verify-gap.log'
    'verify-persona.log'
    'verify-seed.log'
    'verify-ask4.log'
    'verify-voice-hint.log'
)

foreach ($name in $oldLogs) {
    $p = Resolve-InRoot (Join-Path $root "work\rebrand\$name")
    if (-not (Test-Path -LiteralPath $p)) {
        continue
    }
    $freed += (Get-Item -LiteralPath $p).Length
    Remove-Item -LiteralPath $p -Force
    $removed++
    Note "删除旧日志：work\rebrand\$name"
}

Note ("== 完成：删除 {0} 项，释放 {1:N1} MB ==" -f $removed, ($freed / 1MB))

$lines | Set-Content -LiteralPath $log -Encoding utf8
