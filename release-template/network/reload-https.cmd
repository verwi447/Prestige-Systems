@echo off
setlocal EnableExtensions

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0reload-https.ps1" %*
exit /b %errorlevel%
