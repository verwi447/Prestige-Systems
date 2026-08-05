$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"

Push-Location $backend
node .\service\uninstall-service.cjs
Pop-Location

Write-Host "Prestige Systems HUB service uninstall requested."
