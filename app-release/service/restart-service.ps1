$ErrorActionPreference = "Stop"

$service = Get-Service -DisplayName "Prestige Systems HUB" -ErrorAction Stop
if ($service.Status -eq "Running") {
  Restart-Service -InputObject $service -Force
} else {
  Start-Service -InputObject $service
}

$service = Get-Service -DisplayName "Prestige Systems HUB" -ErrorAction Stop
Write-Host "Prestige Systems HUB: $($service.Status)"
