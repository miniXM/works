param(
  [string]$ElectronVersion = "37.10.3",
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\release\macos-test")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$clientDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cacheDirectory = Join-Path $clientDirectory ".macos-package-cache"
$applicationName = "JISU VideoMix.app"
$version = (Get-Content -Raw -LiteralPath (Join-Path $clientDirectory "package.json") | ConvertFrom-Json).version

New-Item -ItemType Directory -Force -Path $cacheDirectory, $OutputDirectory | Out-Null

function Get-CachedFile {
  param([string]$Url, [string]$Destination)
  if (-not (Test-Path -LiteralPath $Destination)) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Destination
  }
}

function Add-ZipBytes {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$EntryName,
    [byte[]]$Bytes,
    [int]$UnixMode = 33188
  )
  $entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $entry.ExternalAttributes = $UnixMode -shl 16
  $stream = $entry.Open()
  try { $stream.Write($Bytes, 0, $Bytes.Length) } finally { $stream.Dispose() }
}

function Add-ZipFile {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$EntryName,
    [string]$FilePath,
    [int]$UnixMode = 33188
  )
  Add-ZipBytes -Archive $Archive -EntryName $EntryName -Bytes ([System.IO.File]::ReadAllBytes($FilePath)) -UnixMode $UnixMode
}

function Add-DirectoryTree {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$SourceDirectory,
    [string]$DestinationPrefix
  )
  $source = (Resolve-Path -LiteralPath $SourceDirectory).Path
  foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
    $relative = $file.FullName.Substring($source.Length).TrimStart('\', '/').Replace('\', '/')
    Add-ZipFile -Archive $Archive -EntryName "$DestinationPrefix/$relative" -FilePath $file.FullName
  }
}

function Expand-Tarball {
  param([string]$Tarball, [string]$Destination)
  if (Test-Path -LiteralPath $Destination) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & tar.exe -xzf $Tarball -C $Destination
  if ($LASTEXITCODE -ne 0) { throw "Failed to extract $Tarball" }
}

function New-MacTestPackage {
  param(
    [ValidateSet("x64", "arm64")][string]$Architecture,
    [string]$FfmpegVersion
  )

  $electronZip = Join-Path $cacheDirectory "electron-v$ElectronVersion-darwin-$Architecture.zip"
  $ffmpegTarball = Join-Path $cacheDirectory "ffmpeg-darwin-$Architecture-$FfmpegVersion.tgz"
  $ffmpegDirectory = Join-Path $cacheDirectory "ffmpeg-darwin-$Architecture-$FfmpegVersion"
  $destinationZip = Join-Path $OutputDirectory "JISU-VideoMix-$version-macos-$Architecture-unsigned-test.zip"

  Get-CachedFile -Url "https://github.com/electron/electron/releases/download/v$ElectronVersion/electron-v$ElectronVersion-darwin-$Architecture.zip" -Destination $electronZip
  Get-CachedFile -Url "https://registry.npmjs.org/@ffmpeg-installer/darwin-$Architecture/-/darwin-$Architecture-$FfmpegVersion.tgz" -Destination $ffmpegTarball
  Expand-Tarball -Tarball $ffmpegTarball -Destination $ffmpegDirectory

  if (Test-Path -LiteralPath $destinationZip) { Remove-Item -LiteralPath $destinationZip -Force }
  $sourceArchive = [System.IO.Compression.ZipFile]::OpenRead($electronZip)
  $destinationArchive = [System.IO.Compression.ZipFile]::Open($destinationZip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($sourceEntry in $sourceArchive.Entries) {
      if ($sourceEntry.FullName -eq "Electron.app/Contents/Resources/default_app.asar") { continue }
      $entryName = $sourceEntry.FullName -replace '^Electron\.app/', "$applicationName/"
      $destinationEntry = $destinationArchive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $destinationEntry.ExternalAttributes = $sourceEntry.ExternalAttributes
      $destinationEntry.LastWriteTime = $sourceEntry.LastWriteTime
      if ($sourceEntry.Length -eq 0) { continue }
      $input = $sourceEntry.Open()
      $output = $destinationEntry.Open()
      try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
    }

    $resourceRoot = "$applicationName/Contents/Resources"
    $appRoot = "$resourceRoot/app"
    foreach ($directory in @("electron", "backend", "renderer")) {
      Add-DirectoryTree -Archive $destinationArchive -SourceDirectory (Join-Path $clientDirectory $directory) -DestinationPrefix "$appRoot/$directory"
    }
    Add-ZipFile -Archive $destinationArchive -EntryName "$appRoot/package.json" -FilePath (Join-Path $clientDirectory "package.json")
    Add-DirectoryTree -Archive $destinationArchive -SourceDirectory (Join-Path $clientDirectory "node_modules\@ffmpeg-installer\ffmpeg") -DestinationPrefix "$appRoot/node_modules/@ffmpeg-installer/ffmpeg"
    Add-DirectoryTree -Archive $destinationArchive -SourceDirectory (Join-Path $ffmpegDirectory "package") -DestinationPrefix "$appRoot/node_modules/@ffmpeg-installer/darwin-$Architecture"
    Add-DirectoryTree -Archive $destinationArchive -SourceDirectory (Join-Path $clientDirectory "backend") -DestinationPrefix "$resourceRoot/backend"
  } finally {
    $destinationArchive.Dispose()
    $sourceArchive.Dispose()
  }

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destinationZip).Hash.ToLowerInvariant()
  "$hash  $(Split-Path -Leaf $destinationZip)" | Set-Content -Encoding ascii -LiteralPath "$destinationZip.sha256"
  Write-Host "Created $destinationZip"
}

New-MacTestPackage -Architecture "x64" -FfmpegVersion "4.1.0"
New-MacTestPackage -Architecture "arm64" -FfmpegVersion "4.1.5"
