@echo off
setlocal

set "SERVICE_NAME=prestigesystemshub.exe"

echo Restarting Prestige Systems HUB service...
sc stop "%SERVICE_NAME%"
if errorlevel 1 exit /b %errorlevel%

sc start "%SERVICE_NAME%"
if errorlevel 1 exit /b %errorlevel%

timeout /t 3 /nobreak >nul
sc query "%SERVICE_NAME%"
