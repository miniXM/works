#requires -version 7
#
# 把脚本里指向已删除的 1.1.2 安装包的路径改成现在的 1.0.0 安装包，
# 并删掉两个只针对旧包的一次性探测脚本。
# 只动“安装包文件名”这一个字符串，不动脚本里的版本号断言（那些是自洽的）。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = 'E:\GPT Codex\2026-09-15\new-chat'
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

$skip = @(
    'work\rebrand\cleanup-outdated.ps1'
    'work\rebrand\cleanup-round2.ps1'
    'work\rebrand\fix-old-installer-refs.ps1'
)

$rules = @(
    @{ Old = 'JSVideoMix-Setup-1.1.2.exe'; New = 'JSVideoMix-Setup-1.0.0.exe' }
    @{ Old = 'VideoMix-Setup-1.1.2.exe';    New = 'JSVideoMix-Setup-1.0.0.exe' }
)

Note '== 修正脚本里的旧安装包路径 =='

$files = Get-ChildItem -LiteralPath (Join-Path $root 'work') -Recurse -File -Include '*.ps1', '*.py'
foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length + 1)
    if ($skip -contains $rel) { continue }
    $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding utf8
    $before = $text
    foreach ($r in $rules) {
        $text = $text.Replace($r.Old, $r.New)
    }
    if ($text -ne $before) {
        Set-Content -LiteralPath $f.FullName -Value $text -NoNewline -Encoding utf8
        Note "已改：$rel"
    }
}

# ---------- 删掉只服务于旧包的一次性探测脚本 ----------

$deadScripts = @(
    'work\rebrand\probe\grep-setup.py'
    'work\rebrand\probe\grep-setup2.py'
)

foreach ($rel in $deadScripts) {
    $p = Resolve-InRoot (Join-Path $root $rel)
    if (Test-Path -LiteralPath $p) {
        Remove-Item -LiteralPath $p -Force
        Note "删除过时探测脚本：$rel"
    }
}

Note '== 完成 =='

$lines | Set-Content -LiteralPath (Join-Path $root 'work\rebrand\fix-old-installer-refs.log') -Encoding utf8
