$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repo = "Shishir435/ollama-client"
$version = if ($env:OLC_VERSION) { $env:OLC_VERSION } else { "latest" }
$installDir = if ($env:OLC_INSTALL_DIR) {
  $env:OLC_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA "Programs\olc"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22.12 or newer is required: https://nodejs.org/"
}
$nodeVersion = [version](& node -p "process.versions.node")
if ($nodeVersion -lt [version]"22.12.0") {
  throw "Node.js 22.12 or newer is required; found $nodeVersion"
}

$baseUrl = if ($env:OLC_DOWNLOAD_BASE_URL) {
  $env:OLC_DOWNLOAD_BASE_URL.TrimEnd("/")
} elseif ($version -eq "latest") {
  "https://github.com/$repo/releases/latest/download"
} else {
  "https://github.com/$repo/releases/download/$version"
}
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("olc-install-" + [guid]::NewGuid())
$archive = Join-Path $tempDir "olc.zip"
$checksum = Join-Path $tempDir "olc.zip.sha256"
$parentDir = Split-Path -Parent $installDir
$stageDir = Join-Path $parentDir (".olc-install-" + [guid]::NewGuid())
$backupDir = Join-Path $parentDir (".olc-backup-" + [guid]::NewGuid())

try {
  New-Item -ItemType Directory -Force -Path $tempDir, $parentDir | Out-Null
  Write-Host "Downloading olc ($version)..."
  Invoke-WebRequest -UseBasicParsing "$baseUrl/olc.zip" -OutFile $archive
  Invoke-WebRequest -UseBasicParsing "$baseUrl/olc.zip.sha256" -OutFile $checksum

  $expected = ((Get-Content -Raw $checksum).Trim() -split "\s+")[0]
  $actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) {
    throw "Checksum verification failed"
  }

  Expand-Archive -Path $archive -DestinationPath $tempDir -Force
  $payload = Join-Path $tempDir "olc"
  if (-not (Test-Path (Join-Path $payload "dist\olc.mjs"))) {
    throw "Release archive is missing olc.mjs"
  }
  Move-Item $payload $stageDir
  if (Test-Path $installDir) {
    Move-Item $installDir $backupDir
  }
  try {
    Move-Item $stageDir $installDir
  } catch {
    if (Test-Path $backupDir) { Move-Item $backupDir $installDir }
    throw
  }
  if (Test-Path $backupDir) { Remove-Item -Recurse -Force $backupDir }

  $binDir = Join-Path $installDir "bin"
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathParts = @($userPath -split ";" | Where-Object { $_ })
  if ($pathParts -notcontains $binDir) {
    [Environment]::SetEnvironmentVariable("Path", (($pathParts + $binDir) -join ";"), "User")
  }
  if (($env:Path -split ";") -notcontains $binDir) {
    $env:Path = "$env:Path;$binDir"
  }
  Write-Host "Installed olc in $installDir"
  Write-Host "Open a new terminal, then run: olc --help"
} finally {
  if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
  if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
}
