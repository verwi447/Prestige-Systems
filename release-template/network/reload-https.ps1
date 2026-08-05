param(
  [string]$AppPath = "C:\PrestigeSystemsHub",
  [string]$CaddyPath = "C:\Caddy\caddy.exe"
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path ([System.IO.Path]::GetFullPath($AppPath)) "network\Caddyfile"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Brak pliku Caddyfile: $configPath"
}
if (-not (Test-Path -LiteralPath $CaddyPath)) {
  throw "Brak pliku caddy.exe: $CaddyPath"
}

& $CaddyPath validate --config $configPath --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw "Konfiguracja Caddy nie przeszla walidacji." }
& $CaddyPath reload --config $configPath --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw "Nie udalo sie przeladowac konfiguracji HTTPS." }
Write-Host "Konfiguracja HTTPS zostala przeladowana."
