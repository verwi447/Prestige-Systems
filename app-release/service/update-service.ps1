param(
  [string]$ReleasePath = (Split-Path -Parent $PSScriptRoot),
  [string]$InstallPath = "C:\PrestigeSystemsHub",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$serviceDisplayName = "Prestige Systems HUB"
$payloadPaths = @(
  "app-version.json",
  "VERSION.txt",
  "RELEASE_MANIFEST.json",
  "INSTALL.md",
  "backend\\package.json",
  "backend\\package-lock.json",
  "backend\\.env.example",
  "backend\\src",
  "backend\\scripts",
  "backend\\service",
  "backend\\assets",
  "frontend\\dist",
  "service"
)

function Resolve-ExistingPath([string]$Path, [string]$Label) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolved)) {
    throw "$Label nie istnieje: $resolved"
  }
  return $resolved.TrimEnd("\\", "/")
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$Description) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description nie powiodlo sie (kod: $LASTEXITCODE)."
  }
}

function Copy-Path([string]$SourceRoot, [string]$TargetRoot, [string]$RelativePath) {
  $source = Join-Path $SourceRoot $RelativePath
  $target = Join-Path $TargetRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Brak wymaganego pliku wydania: $RelativePath"
  }

  $parent = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $item = Get-Item -LiteralPath $source
  if ($item.PSIsContainer) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Recurse -Force
    }
  } else {
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
}

function Copy-Payload([string]$SourceRoot, [string]$TargetRoot) {
  foreach ($relativePath in $payloadPaths) {
    Copy-Path $SourceRoot $TargetRoot $relativePath
  }
}

function Wait-ServiceState([string]$Name, [string]$ExpectedStatus, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -DisplayName $Name -ErrorAction Stop
    if ($service.Status.ToString() -eq $ExpectedStatus) {
      return
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "Usluga $Name nie osiagnela stanu $ExpectedStatus w ciagu $TimeoutSeconds sekund."
}

function Test-ApplicationVersion([string]$ExpectedVersion, [string]$ExpectedSchemaVersion) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:5000/app-version.json" -TimeoutSec 5
      $appInfo = $response.Content | ConvertFrom-Json
      $version = [string]$appInfo.version
      $schemaVersion = [string]$appInfo.schemaVersion
      if ($response.StatusCode -eq 200 -and $version -eq $ExpectedVersion -and $schemaVersion -eq $ExpectedSchemaVersion) {
        return
      }
    } catch {
      # The service can still be starting.
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "Aplikacja nie zwrocila oczekiwanej wersji $ExpectedVersion i schematu $ExpectedSchemaVersion pod /app-version.json."
}

if (-not (Test-Administrator)) {
  throw "Uruchom aktualizacje w terminalu PowerShell jako administrator."
}

$releaseRoot = Resolve-ExistingPath $ReleasePath "Katalog nowego wydania"
$installRoot = Resolve-ExistingPath $InstallPath "Katalog zainstalowanej aplikacji"
if ($releaseRoot -eq $installRoot) {
  throw "Nowe wydanie musi znajdowac sie poza katalogiem zainstalowanej aplikacji."
}

$manifestPath = Join-Path $releaseRoot "RELEASE_MANIFEST.json"
$versionPath = Join-Path $releaseRoot "app-version.json"
if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $versionPath)) {
  throw "Katalog wydania nie zawiera poprawnego manifestu ani app-version.json."
}

$releaseAppInfo = Get-Content -Raw -LiteralPath $versionPath | ConvertFrom-Json
$releaseManifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$releaseVersion = [string]($releaseAppInfo.version)
$releaseSchemaVersion = [string]($releaseAppInfo.schemaVersion)
if ([string]::IsNullOrWhiteSpace($releaseVersion)) {
  throw "Wydanie nie ma poprawnego numeru wersji."
}
if ([string]::IsNullOrWhiteSpace($releaseSchemaVersion)) {
  throw "Wydanie nie ma poprawnej wersji schematu bazy danych."
}
if (([string]($releaseManifest.version)) -ne $releaseVersion -or ([string]($releaseManifest.schemaVersion)) -ne $releaseSchemaVersion) {
  throw "Manifest wydania nie jest zgodny z numerem wersji aplikacji lub schematu."
}

$envPath = Join-Path $installRoot "backend\\.env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Brak pliku backend\\.env w zainstalowanej aplikacji."
}

$releaseForbidden = @("backend\\.env", "backend\\uploads", "backend\\system-backups", "backend\\node_modules") |
  Where-Object { Test-Path -LiteralPath (Join-Path $releaseRoot $_) }
if ($releaseForbidden.Count -gt 0) {
  throw "Paczka wydania zawiera niedozwolone dane runtime: $($releaseForbidden -join ', ')."
}

$installedVersionPath = Join-Path $installRoot "app-version.json"
$installedVersion = if (Test-Path -LiteralPath $installedVersionPath) {
  [string]((Get-Content -Raw -LiteralPath $installedVersionPath | ConvertFrom-Json).version)
} else {
  "brak"
}
if (-not $Force -and $installedVersion -eq $releaseVersion) {
  throw "Zainstalowana jest juz wersja $releaseVersion. Uzyj -Force tylko do ponownego wdrozenia tego samego wydania."
}

$timestamp = Get-Date -Format "yyyy-MM-dd-HH-mm-ss"
$rollbackRoot = Join-Path $installRoot ".update-rollback\\$timestamp"
$rollbackReady = $false
$migrationStarted = $false
$serviceStopped = $false

try {
  Write-Host "Tworzenie i test backupu przed aktualizacja..."
  Push-Location (Join-Path $installRoot "backend")
  try {
    Invoke-Checked "node" @(".\\scripts\\createPreUpdateBackup.js") "Backup przed aktualizacja"
  } finally {
    Pop-Location
  }

  Write-Host "Zapisywanie kopii plikow do cofniecia: $rollbackRoot"
  New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null
  Copy-Payload $installRoot $rollbackRoot
  $rollbackReady = $true

  $service = Get-Service -DisplayName $serviceDisplayName -ErrorAction Stop
  if ($service.Status -eq "Running") {
    Write-Host "Zatrzymywanie uslugi..."
    Stop-Service -InputObject $service -Force
    Wait-ServiceState $serviceDisplayName "Stopped"
    $serviceStopped = $true
  }

  Write-Host "Aktualizowanie plikow aplikacji do wersji $releaseVersion..."
  Copy-Payload $releaseRoot $installRoot

  Push-Location (Join-Path $installRoot "backend")
  try {
    Invoke-Checked "npm.cmd" @("ci", "--omit=dev") "Instalacja zaleznosci produkcyjnych"
    $migrationStarted = $true
    Invoke-Checked "npm.cmd" @("run", "db:migrate") "Migracja bazy danych"
  } finally {
    Pop-Location
  }

  Write-Host "Uruchamianie uslugi..."
  Start-Service -DisplayName $serviceDisplayName
  Wait-ServiceState $serviceDisplayName "Running"
  Test-ApplicationVersion $releaseVersion $releaseSchemaVersion

  Write-Host "Aktualizacja zakonczona poprawnie. Wersja: $releaseVersion, schemat: $releaseSchemaVersion"
  Write-Host "Kopia do cofniecia: $rollbackRoot"
} catch {
  $message = $_.Exception.Message
  Write-Error "Aktualizacja nie powiodla sie: $message"

  if ($rollbackReady -and -not $migrationStarted) {
    Write-Warning "Przywracanie poprzednich plikow aplikacji..."
    try {
      Copy-Payload $rollbackRoot $installRoot
      if ($serviceStopped) {
        Start-Service -DisplayName $serviceDisplayName
        Wait-ServiceState $serviceDisplayName "Running"
      }
      Write-Warning "Przywrocono poprzednie pliki aplikacji."
    } catch {
      Write-Error "Nie udalo sie automatycznie przywrocic poprzednich plikow: $($_.Exception.Message)"
    }
  } elseif ($migrationStarted) {
    Write-Warning "Migracja bazy danych zostala rozpoczeta. Nie wykonano automatycznego cofniecia kodu. Uzyj backupu przed aktualizacja, jesli potrzebne jest pelne wycofanie."
  }

  exit 1
}
