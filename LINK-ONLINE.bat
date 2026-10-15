@echo off
chcp 65001 >nul
rem Doppio clic: avvia Omar AI e crea un link web (https://....trycloudflare.com) da aprire nel browser di qualsiasi PC.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0link-online.ps1"
