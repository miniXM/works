#requires -version 7
# 只重建 app.asar + 主程序（不拼 1GB 安装包），并同步到 shots\app，用来快速看效果。
# 正式出包还是要跑 rebrand.py。
param(
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild',
    [switch]$NoSync
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$here = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand'
$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$build = Join-Path $here 'build'
$out = Join-Path $build 'out'
$images = Join-Path $build 'images'
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Output '[1/4] 生成替换规则'
& $py (Join-Path $here 'make_rules.py') --config (Join-Path $here 'brand.json') `
    --images $images --out (Join-Path $build 'rules.json')

Write-Output '[2/4] 重建 app.asar'
& $py (Join-Path $here 'build_asar.py') --base (Join-Path $here 'base\app.asar') `
    --rules (Join-Path $build 'rules.json') --out (Join-Path $out 'app.asar')

Write-Output '[3/4] 复制主程序并同步完整性哈希'
Copy-Item -LiteralPath (Join-Path $here 'base\videomix.exe') -Destination (Join-Path $out 'videomix.exe') -Force
& $py (Join-Path $here 'patch_integrity.py') (Join-Path $out 'videomix.exe') (Join-Path $out 'app.asar')

if ($NoSync) { Write-Output '[4/4] 按 -NoSync 跳过同步'; return }

Write-Output '[4/4] 同步到 shots\app'
$shot = Join-Path $here 'shots\app'
Copy-Item -LiteralPath (Join-Path $out 'app.asar') -Destination (Join-Path $shot 'videomix\resources\app.asar') -Force
Copy-Item -LiteralPath (Join-Path $out 'videomix.exe') -Destination (Join-Path $shot 'videomix\videomix.exe') -Force
Write-Output '完成（如果想连着品牌图标一起换，跑 rebrand.py 或先执行 make_images.py）'
