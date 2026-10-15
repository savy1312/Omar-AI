@echo off
chcp 65001 >nul
rem Pubblica la pagina di download di Omar AI su Netlify (https://<nome>.netlify.app).
rem La prima volta si apre il browser per entrare (o registrarti gratis) su Netlify.
cd /d "%~dp0sito"
where node >nul 2>nul || (echo Node.js non trovato. Installalo da https://nodejs.org & pause & exit /b 1)
echo.
echo === 1/2 Accesso a Netlify ===
call npx --yes netlify-cli@latest login || (pause & exit /b 1)
echo.
echo === 2/2 Pubblico. Se chiede, scegli "Create & configure a new site" e come nome omar-ai (se e' gia' preso: omar-ai-oleggio) ===
call npx --yes netlify-cli@latest deploy --prod --dir . || (pause & exit /b 1)
echo.
echo Fatto: l'indirizzo pubblico e' la riga "Website URL" qui sopra.
pause
