@echo off
setlocal EnableExtensions

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-service.ps1" -ReleasePath "%~dp0.." %*
exit /b %errorlevel%
