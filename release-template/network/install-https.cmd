@echo off
setlocal EnableExtensions

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-https.ps1" %*
exit /b %errorlevel%
