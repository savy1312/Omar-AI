@echo off
chcp 65001 >nul
rem Pubblica la pagina di download di Omar AI su Vercel (https://<nome>.vercel.app).
rem La prima volta si apre il browser per entrare (o registrarti gratis) su Vercel.
cd /d "%~dp0sito"
where node >nul 2>nul || (echo Node.js non trovato. Installalo da https://nodejs.org & pause & exit /b 1)
echo Quando chiede il nome del progetto scrivi: omar-ai   (se e' gia' preso: omar-ai-oleggio)
call npx --yes vercel@latest deploy --prod || (pause & exit /b 1)
echo.
echo Fatto: l'indirizzo pubblico e' la riga "Production" / "Aliased" qui sopra.
pause
