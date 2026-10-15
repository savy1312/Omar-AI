@echo off
chcp 65001 >nul
title Omar AI - browser
cd /d "%~dp0"
set PORT=3300
if exist .env for /f "tokens=2 delims==" %%a in ('findstr /b "PORT=" .env') do set PORT=%%a
set URL=http://localhost:%PORT%

rem Se Omar e' gia' acceso, apro solo il browser.
curl -s -o nul --max-time 2 %URL%/desktop/ping && (start "" "%URL%/" & exit /b 0)

where node >nul 2>nul || (echo Node.js 22.13 o successivo non trovato. Installalo da https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Installo le dipendenze... & call npm install || (pause & exit /b 1))
if not exist .env (copy .env.example .env >nul)

rem Modalita' BROWSER (solo per questa finestra): apre http://localhost:PORT senza chiave,
rem al posto della modalita' applicazione (icona Omar AI). Il .env non viene modificato.
set DESKTOP_ONLY=false
echo.
echo Omar AI in modalita' BROWSER su %URL%/  -  NON chiudere questa finestra.
echo Apro il browser...
start "" "%URL%/"
call npm start
pause
