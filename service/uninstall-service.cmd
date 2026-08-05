@echo off
setlocal

cd /d "%~dp0..\backend"

echo Uninstalling Prestige Systems HUB Windows service...
node .\service\uninstall-service.cjs
if errorlevel 1 exit /b %errorlevel%

echo.
echo Service uninstall requested.
pause
