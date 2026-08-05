@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Uruchom ten skrypt jako administrator.
  exit /b 1
)

if not exist "backend\.env" (
  echo Brak pliku backend\.env. Skopiuj backend\.env.example i uzupelnij konfiguracje.
  exit /b 1
)

echo Instalowanie zaleznosci produkcyjnych backendu...
pushd backend
call npm ci --omit=dev
if errorlevel 1 (
  popd
  exit /b %errorlevel%
)

echo Instalowanie uslugi Prestige Systems HUB...
node .\service\install-service.cjs
set "RESULT=%errorlevel%"
popd

if not "%RESULT%"=="0" exit /b %RESULT%

echo Instalacja uslugi zostala zlecona. Sprawdz usluge "Prestige Systems HUB" w systemie Windows.
exit /b 0
