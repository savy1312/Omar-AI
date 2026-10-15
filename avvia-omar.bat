@echo off
chcp 65001 >nul
title Omar AI
cd /d "%~dp0"
set PORT=3300
if exist .env for /f "tokens=2 delims==" %%a in ('findstr /b "PORT=" .env') do set PORT=%%a
set URL=http://localhost:%PORT%

rem Omar e' gia' acceso (ad esempio doppio clic sull'icona una seconda volta)? Apro solo la finestra.
curl -s -o nul --max-time 2 %URL%/desktop/ping && (node scripts\apri-finestra.js %PORT% & exit /b 0)

where node >nul 2>nul || (echo Node.js 22.13 o successivo non trovato. Installalo da https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Installo le dipendenze... & call npm install || (pause & exit /b 1))
if not exist .env (copy .env.example .env >nul)
echo Collego Ollama...
call npm run setup:ollama
if errorlevel 1 (echo. & echo Collegamento a Ollama non riuscito: leggi sopra. & pause & exit /b 1)
rem apre la finestra dell'app (Edge/Chrome in modalita' app) appena il server risponde
start "" /b node scripts\apri-finestra.js %PORT%
echo.
echo Omar AI e' acceso su %URL%  -  NON chiudere questa finestra: chiudendola Omar si spegne.
echo.
call npm start
pause
