@echo off
setlocal EnableExtensions

cd /d "%~dp0..\backend"
node .\service\uninstall-service.cjs
exit /b %errorlevel%
