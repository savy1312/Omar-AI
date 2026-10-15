@echo off
chcp 65001 >nul
title Installazione di Omar AI
rem Installa Omar AI per l'utente corrente (senza permessi di amministratore) e crea l'icona "Omar AI"
rem sul Desktop e nel menu Start. Aggiornando una versione gia' installata, .env e dati restano intatti.
set SRC=%~dp0
if not exist "%SRC%package.json" (
  echo Estrai prima TUTTO lo .zip: tasto destro sul file scaricato ^> "Estrai tutto...",
  echo poi apri questo file dalla cartella estratta.
  pause & exit /b 1
)
set DEST=%LOCALAPPDATA%\Programs\OmarAI
echo Installo Omar AI in "%DEST%"...
robocopy "%SRC%." "%DEST%" /E /XD data node_modules .git /XF .env /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo Copia non riuscita. & pause & exit /b 1)

rem i file scaricati da internet sono "bloccati" da Windows: li sblocco perche' sono quelli di Omar appena installato
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\OmarAI') -Recurse -File | Unblock-File" >nul 2>nul

echo Creo l'icona sul Desktop e nel menu Start...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=Join-Path $env:LOCALAPPDATA 'Programs\OmarAI'; $ws=New-Object -ComObject WScript.Shell;" ^
  "foreach($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){" ^
  "  $l=$ws.CreateShortcut((Join-Path $dir 'Omar AI.lnk'));" ^
  "  $l.TargetPath=(Join-Path $d 'avvia-omar.bat'); $l.WorkingDirectory=$d;" ^
  "  $l.IconLocation=(Join-Path $d 'omar-ai.ico'); $l.WindowStyle=1;" ^
  "  $l.Description='Omar AI - tutor IA dell''ITIS Omar'; $l.Save() }"
if errorlevel 1 (echo Non sono riuscito a creare l'icona: puoi avviare Omar da "%DEST%\avvia-omar.bat". & pause & exit /b 1)

echo.
echo Fatto! Sul Desktop trovi l'icona "Omar AI".
echo Al primo avvio servono Node.js (https://nodejs.org) e Ollama (https://ollama.com):
echo Omar scarica i modelli IA una volta sola (circa 8 GB).
echo.
choice /c SN /m "Avvio Omar AI adesso"
if errorlevel 2 exit /b 0
start "" "%DEST%\avvia-omar.bat"
