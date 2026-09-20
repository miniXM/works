#requires -version 7
# 把账号档案这一轮的验证截图拷进交付目录（先删掉上一轮的 19~22）。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$src = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\probe\persona'
$dst = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild\截图'

# 上一轮用这 4 个名字，这轮编号整体往后挪一位，多了一张「默认示例档案」。
foreach ($old in @(
        '19-账号档案-AI问答框.png',
        '20-账号档案-AI问答-已填写.png',
        '21-账号档案-AI生成后.png',
        '22-账号档案-没配Key的提示.png')) {
    $path = Join-Path $dst $old
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

$pairs = @(
    @('10-默认模板-账号档案.png', '19-账号档案-默认示例档案.png'),
    @('11-新建档案自动弹AI.png', '20-账号档案-新建档案自动弹AI.png'),
    @('01-AI问答框.png', '21-账号档案-AI问答框.png'),
    @('02-已填写.png', '22-账号档案-AI问答-已填写.png'),
    @('04-AI生成后的档案.png', '23-账号档案-AI生成后.png'),
    @('07-没Key的提示.png', '24-账号档案-没配Key的提示.png')
)
foreach ($pair in $pairs) {
    $from = Join-Path $src $pair[0]
    $to = Join-Path $dst $pair[1]
    Copy-Item -LiteralPath $from -Destination $to -Force
    Write-Output ("{0}  ->  {1}（{2} 字节）" -f $pair[0], $pair[1], (Get-Item -LiteralPath $to).Length)
}
