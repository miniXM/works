#requires -version 7
# 启动某个安装目录里的 Electron 主程序，抓 stderr，看它为什么起不来。
param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [int]$Wait = 12
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$appDir = Join-Path $Dir 'videomix'
$exe = Join-Path $appDir 'videomix.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "找不到 $exe" }

foreach ($name in @('videomix', 'KrLongAI')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

$errFile = Join-Path $env:TEMP ('probe-' + [guid]::NewGuid().ToString('N') + '.err.txt')
$outFile = Join-Path $env:TEMP ('probe-' + [guid]::NewGuid().ToString('N') + '.out.txt')
$process = Start-Process -FilePath $exe -PassThru -WorkingDirectory $appDir `
    -RedirectStandardError $errFile -RedirectStandardOutput $outFile
Start-Sleep -Seconds $Wait

if ($process.HasExited) {
    Write-Output ("退出码 {0}（0x{1:X8}）" -f $process.ExitCode, [uint32]$process.ExitCode)
} else {
    Write-Output '进程还活着'
}
foreach ($file in @($errFile, $outFile)) {
    $text = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
    if ($text) { Write-Output ("--- {0} ---`n{1}" -f (Split-Path $file -Leaf), $text) }
}

foreach ($name in @('videomix', 'KrLongAI')) {
    Get-Process $name -ErrorAction SilentlyContinue |
        Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String |
        Write-Output
}
