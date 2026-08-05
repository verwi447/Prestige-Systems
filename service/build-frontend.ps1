$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"

Push-Location $frontend
npm install
npm run build
Pop-Location

Write-Host "Frontend build completed."
