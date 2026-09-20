#requires -version 7
# 复制一份装好的客户端，并把主程序 / asar 换成指定的版本，用来做对照实验。
param(
    [Parameter(Mandatory = $true)][string]$Source,   # 已安装目录（含 videomix 子目录）
    [Parameter(Mandatory = $true)][string]$Target,   # 新目录（必须不存在）
    [string]$Exe = '',
    [string]$Asar = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (Test-Path -LiteralPath $Target) { throw "目标目录已存在，请换一个名字：$Target" }
Copy-Item -LiteralPath $Source -Destination $Target -Recurse
if ($Exe) { Copy-Item -LiteralPath $Exe -Destination (Join-Path $Target 'videomix\videomix.exe') -Force }
if ($Asar) { Copy-Item -LiteralPath $Asar -Destination (Join-Path $Target 'videomix\resources\app.asar') -Force }
Write-Output "已生成对照目录：$Target"
