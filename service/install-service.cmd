@echo off
setlocal

cd /d "%~dp0.."

echo Building frontend...
cd /d "%~dp0..\frontend"
call npm install
if errorlevel 1 exit /b %errorlevel%
call npm run build
if errorlevel 1 exit /b %errorlevel%

echo Installing backend dependencies...
cd /d "%~dp0..\backend"
call npm install
if errorlevel 1 exit /b %errorlevel%

echo Installing Prestige Systems HUB Windows service...
node .\service\install-service.cjs
if errorlevel 1 exit /b %errorlevel%

echo.
echo Service install requested. Check Windows Services for "Prestige Systems HUB".
pause
