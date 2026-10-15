@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem Rende Omar AI raggiungibile da internet con un tunnel Cloudflare gratuito (indirizzo *.trycloudflare.com).
rem Leggi prima LEGGIMI-PUBBLICAZIONE.txt: con l'app su internet i dati degli studenti passano da internet.
cd /d "%~dp0.."
if not exist .env (echo Avvia prima Omar almeno una volta con avvia-omar.bat. & pause & exit /b 1)

rem --- controlli di sicurezza minimi ---
set BAD=
findstr /r /c:"^TEACHER_REGISTRATION_CODE=cambia-questo" .env >nul && set BAD=1
findstr /r /c:"^STUDENT_REGISTRATION_CODE=cambia-questo" .env >nul && set BAD=1
findstr /r /c:"^ALLOW_OPEN_REGISTRATION=true" .env >nul && set BAD=1
if defined BAD (
  echo Prima di mettere Omar su internet apri il file .env e:
  echo   - scegli codici di registrazione tuoi e difficili da indovinare
  echo     ^(STUDENT_REGISTRATION_CODE e TEACHER_REGISTRATION_CODE^)
  echo   - lascia ALLOW_OPEN_REGISTRATION=false
  pause & exit /b 1
)

rem --- cloudflared: se manca lo installa con winget ---
where cloudflared >nul 2>nul || (
  echo Installo cloudflared ^(programma ufficiale di Cloudflare^)...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements || (echo Installa a mano da https://github.com/cloudflare/cloudflared/releases & pause & exit /b 1)
  echo Chiudi e riapri questo script per completare l'installazione. & pause & exit /b 0
)

set PORT=3300
for /f "tokens=2 delims==" %%a in ('findstr /b "PORT=" .env') do set PORT=%%a
rem dietro il tunnel Omar deve leggere l'indirizzo reale di chi si collega (limiti anti-abuso)
set TRUST_PROXY=true
echo Avvio Omar AI...
start "Omar AI" cmd /k npm start
timeout /t 6 >nul
echo.
echo Apro il tunnel: tra poco compare l'indirizzo pubblico https://....trycloudflare.com
echo Resta attivo finche' questa finestra e' aperta. Chiudila per togliere Omar da internet.
echo.
cloudflared tunnel --url http://localhost:%PORT%
