param(
  [Parameter(Mandatory = $true)]
  [string]$Domain,
  [Parameter(Mandatory = $true)]
  [string]$Email,
  [string]$AppPath = "C:\PrestigeSystemsHub",
  [string]$CaddyPath = "C:\Caddy\caddy.exe",
  [switch]$SkipFirewall
)

$ErrorActionPreference = "Stop"
$proxyServiceName = "PrestigeSystemsHubProxy"
$backendServiceName = "Prestige Systems HUB"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-ExistingPath([string]$Path, [string]$Label) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolved)) {
    throw "$Label nie istnieje: $resolved"
  }
  return $resolved
}

function Get-DotEnvValue([string]$Path, [string]$Key) {
  $match = Select-String -LiteralPath $Path -Pattern "^$([Regex]::Escape($Key))=(.*)$" | Select-Object -First 1
  return if ($match) { $match.Matches[0].Groups[1].Value.Trim() } else { "" }
}

function Set-DotEnvValue([string]$Path, [string]$Key, [string]$Value) {
  $content = Get-Content -Raw -LiteralPath $Path
  $pattern = "(?m)^$([Regex]::Escape($Key))=.*$"
  $line = "$Key=$Value"
  if ([Regex]::IsMatch($content, $pattern)) {
    $content = [Regex]::Replace($content, $pattern, $line)
  } else {
    $content = "$($content.TrimEnd())`r`n$line`r`n"
  }
  Set-Content -LiteralPath $Path -Value $content -Encoding utf8
}

function Wait-ServiceState([string]$DisplayName, [string]$ExpectedState, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -DisplayName $DisplayName -ErrorAction Stop
    if ($service.Status.ToString() -eq $ExpectedState) {
      return
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "Usluga $DisplayName nie osiagnela stanu $ExpectedState."
}

function Test-BackendHealth {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5000/healthz" -TimeoutSec 5
      if ($response.StatusCode -eq 200 -and ($response.Content | ConvertFrom-Json).status -eq "ok") {
        return
      }
    } catch {
      # Backend may still be starting after a restart.
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Backend nie odpowiada poprawnie pod http://127.0.0.1:5000/healthz."
}

function Ensure-FirewallRule([string]$DisplayName, [string]$Protocol, [string]$Ports) {
  if (-not (Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $DisplayName -Direction Inbound -Action Allow -Protocol $Protocol -LocalPort $Ports | Out-Null
  }
}

if (-not (Test-Administrator)) {
  throw "Uruchom instalacje HTTPS w terminalu PowerShell jako administrator."
}

$domainName = $Domain.Trim().ToLowerInvariant()
if ($domainName -notmatch '^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$') {
  throw "Podaj publiczna nazwe domeny, np. hub.twoja-domena.pl."
}
if ($Email.Trim() -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
  throw "Podaj poprawny adres e-mail dla certyfikatow HTTPS."
}

$appRoot = Resolve-ExistingPath $AppPath "Katalog aplikacji"
$caddyExecutable = Resolve-ExistingPath $CaddyPath "Plik caddy.exe"
$envPath = Join-Path $appRoot "backend\.env"
$templatePath = Join-Path $PSScriptRoot "Caddyfile.template"
$networkPath = Join-Path $appRoot "network"
$configPath = Join-Path $networkPath "Caddyfile"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Brak pliku backend\.env. Najpierw skonfiguruj aplikacje."
}

$existingProxyService = Get-Service -Name $proxyServiceName -ErrorAction SilentlyContinue
if (-not $existingProxyService -or $existingProxyService.Status -ne "Running") {
  $occupiedPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 80, 443 }
  if ($occupiedPorts) {
    $ports = ($occupiedPorts | Select-Object -ExpandProperty LocalPort -Unique) -join ", "
    throw "Porty $ports sa juz zajete. Zwolnij je przed instalacja reverse proxy."
  }
}

$template = Get-Content -Raw -LiteralPath $templatePath
$config = $template.Replace("{{DOMAIN}}", $domainName).Replace("{{ACME_EMAIL}}", $Email.Trim())
New-Item -ItemType Directory -Path $networkPath -Force | Out-Null
Set-Content -LiteralPath $configPath -Value $config -Encoding utf8

& $caddyExecutable validate --config $configPath --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  throw "Konfiguracja Caddy nie przeszla walidacji."
}

$origins = Get-DotEnvValue $envPath "ALLOWED_ORIGINS" -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$publicOrigin = "https://$domainName"
if ($origins -notcontains $publicOrigin) {
  $origins += $publicOrigin
}
Set-DotEnvValue $envPath "HOST" "127.0.0.1"
Set-DotEnvValue $envPath "TRUST_PROXY" "loopback"
Set-DotEnvValue $envPath "ALLOWED_ORIGINS" ($origins -join ',')

$backendService = Get-Service -DisplayName $backendServiceName -ErrorAction Stop
if ($backendService.Status -eq "Running") {
  Restart-Service -InputObject $backendService -Force
} else {
  Start-Service -InputObject $backendService
}
Wait-ServiceState $backendServiceName "Running"
Test-BackendHealth

if (-not $SkipFirewall) {
  Ensure-FirewallRule "Prestige Systems HUB HTTP" "TCP" "80"
  Ensure-FirewallRule "Prestige Systems HUB HTTPS" "TCP" "443"
  Ensure-FirewallRule "Prestige Systems HUB HTTP3" "UDP" "443"
}

$serviceCommand = "`"$caddyExecutable`" run --config `"$configPath`" --adapter caddyfile"
$proxyService = $existingProxyService
if ($proxyService) {
  & sc.exe config $proxyServiceName binPath= $serviceCommand start= auto | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Nie udalo sie zaktualizowac uslugi Caddy." }
  if ($proxyService.Status -eq "Running") {
    Restart-Service -Name $proxyServiceName -Force
  } else {
    Start-Service -Name $proxyServiceName
  }
} else {
  New-Service -Name $proxyServiceName -DisplayName "Prestige Systems HUB HTTPS Proxy" -BinaryPathName $serviceCommand -StartupType Automatic | Out-Null
  Start-Service -Name $proxyServiceName
}
& sc.exe failure $proxyServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
& sc.exe failureflag $proxyServiceName 1 | Out-Null
Wait-ServiceState "Prestige Systems HUB HTTPS Proxy" "Running"

Write-Host "HTTPS proxy jest uruchomiony. Caddy pobierze certyfikat, gdy DNS domeny $domainName wskazuje na ten serwer, a porty 80 i 443 sa dostepne z internetu."
