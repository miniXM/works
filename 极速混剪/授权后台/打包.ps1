# 把授权后台打成一个可以直接传到宝塔解压的 zip。
# 用法（PowerShell）：  .\打包.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$outDir = Join-Path $root '部署'
$stamp = Get-Date -Format 'yyyyMMdd'
# 版本号从 lib\License.php 的 VM_VERSION 里读，避免和旧包重名、也方便一眼看出是新是旧
$versionTag = 'v0.0.0'
$licenseFile = Join-Path $root 'lib\License.php'
if (Test-Path -LiteralPath $licenseFile) {
    $m = [regex]::Match((Get-Content -LiteralPath $licenseFile -Raw -Encoding UTF8), "VM_VERSION\s*=\s*'([^']+)'")
    if ($m.Success) { $versionTag = 'v' + $m.Groups[1].Value }
}
$zip = Join-Path $outDir "videomix-授权后台-部署包-$versionTag-$stamp.zip"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $zip) {
    try {
        Remove-Item $zip -Force -ErrorAction Stop
    } catch {
        # 老包被占用（比如正开着、杀软在扫），换个带时间的名字继续
        $zip = Join-Path $outDir ("videomix-授权后台-部署包-$stamp-" + (Get-Date -Format 'HHmmss') + ".zip")
    }
}

# 用一个干净的暂存目录，避免把 config.php / 已上传的更新包 / .git 打进去
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("videomix-php-" + [guid]::NewGuid().ToString('N'))
$appDir = Join-Path $stage 'videomix-license'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

$excludeDirs = @('.git', '__pycache__', 'data', '截图', '部署')
$excludeFiles = @('config.php', '*.log', '*.part')

Get-ChildItem -Path $root -Force | Where-Object {
    if ($excludeDirs -contains $_.Name) { return $false }
    foreach ($pattern in $excludeFiles) {
        if ($_.Name -like $pattern) { return $false }
    }
    return $true
} | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $appDir $_.Name) -Recurse -Force
}

# 更新包目录、备份目录保留成空目录（宝塔解压后需要它们可写）
foreach ($sub in @('data\updates', 'data\backups')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $appDir $sub) | Out-Null
    Set-Content -Path (Join-Path $appDir "$sub\.gitkeep") -Value '' -Encoding UTF8
}

Compress-Archive -Path $appDir -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
Write-Host "已生成：$zip"
Write-Host "大小：$size KB"
Write-Host "SHA256：$hash"
