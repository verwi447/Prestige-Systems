$ErrorActionPreference = "Stop"

$serviceName = "prestigesystemshub.exe"

Restart-Service -Name $serviceName -Force
Start-Sleep -Seconds 3
Get-Service -Name $serviceName
