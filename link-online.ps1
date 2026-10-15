# Omar AI con un LINK WEB: avvia Omar e lo rende raggiungibile dal browser di qualsiasi PC con un indirizzo
# https://....trycloudflare.com (tunnel gratuito di Cloudflare, senza account). Il link vale finche' questa finestra e' aperta.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Omar AI - link online'
function Pausa($m) { Write-Host $m; Read-Host 'Premi Invio per chiudere' | Out-Null }

if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$envText = Get-Content .env -Raw
function SetEnv([string]$k, [string]$v) {
  $script:envText = if ($script:envText -match "(?m)^#?\s*$k=.*$") { [regex]::Replace($script:envText, "(?m)^#?\s*$k=.*$", "$k=$v") } else { $script:envText.TrimEnd() + "`r`n$k=$v`r`n" }
  Set-Content -LiteralPath .env -Value $script:envText -NoNewline -Encoding UTF8
}
function Codice([string]$k) { ([regex]::Match($envText, "(?m)^$k=(.*)$")).Groups[1].Value.Trim() }

# --- sicurezza minima: con un link pubblico chiunque vede la pagina di accesso ---
if ((Codice 'ALLOW_OPEN_REGISTRATION') -eq 'true') { SetEnv 'ALLOW_OPEN_REGISTRATION' 'false' }
$doc = Codice 'TEACHER_REGISTRATION_CODE'
if (-not $doc -or $doc -like 'cambia-questo*') {
  Write-Host "`nIl codice DOCENTI e' ancora quello di esempio: con il link online chiunque potrebbe registrarsi come docente." -ForegroundColor Yellow
  do { $nuovo = Read-Host 'Scegli un codice docenti (almeno 10 caratteri, tienilo riservato)' } while ($nuovo.Length -lt 10 -or $nuovo -match '\s')
  SetEnv 'TEACHER_REGISTRATION_CODE' $nuovo
}
$stu = Codice 'STUDENT_REGISTRATION_CODE'
if ($stu -eq 'ER26OCT08' -or $stu -like 'cambia-questo*' -or -not $stu) {
  Write-Host "`nIl codice STUDENTI ($stu) e' visibile a chiunque nel repository GitHub pubblico." -ForegroundColor Yellow
  $nuovo = Read-Host 'Scrivi un nuovo codice studenti (Invio per lasciarlo com''e'')'
  if ($nuovo -and $nuovo.Length -ge 6 -and $nuovo -notmatch '\s') { SetEnv 'STUDENT_REGISTRATION_CODE' $nuovo; Write-Host "Nuovo codice studenti: $nuovo" -ForegroundColor Green }
}

$port = Codice 'PORT'; if (-not $port) { $port = '3300' }
$base = "http://localhost:$port"
try { Invoke-WebRequest "$base/desktop/ping" -UseBasicParsing -TimeoutSec 2 | Out-Null
  Pausa "`nOmar e' gia' acceso in modalita' applicazione. Chiudi la sua finestra nera e rilancia questo file."; exit 1 } catch { }

# --- cloudflared (programma ufficiale Cloudflare): se manca lo installa ---
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) { foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) { if (Test-Path $p) { $cf = $p } } }
if (-not $cf) {
  Write-Host "`nInstallo cloudflared (una volta sola)..."
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) { if (Test-Path $p) { $cf = $p } }
  if (-not $cf) { Pausa "Installazione non riuscita: scarica cloudflared da https://github.com/cloudflare/cloudflared/releases"; exit 1 }
}

# --- avvio di Omar in versione web (solo per questa finestra; il .env resta in modalita' applicazione) ---
if (-not (Test-Path node_modules)) { Write-Host 'Installo le dipendenze...'; npm install }
$env:DESKTOP_ONLY = 'false'; $env:TRUST_PROXY = 'true'
Write-Host "`nAvvio Omar AI..."
$omar = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm start' -WindowStyle Minimized -PassThru
$ok = $false; for ($i = 0; $i -lt 60 -and -not $ok; $i++) { Start-Sleep 1; try { Invoke-WebRequest "$base/desktop/ping" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true } catch { } }
if (-not $ok) { Pausa 'Omar non parte: avvialo con avvia-omar.bat per vedere l''errore.'; exit 1 }

# --- tunnel e link ---
$log = Join-Path $env:TEMP 'omar-link.log'; Remove-Item $log -ErrorAction SilentlyContinue
$tun = Start-Process -FilePath $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', $base, '--logfile', $log -WindowStyle Hidden -PassThru
$url = $null; for ($i = 0; $i -lt 60 -and -not $url; $i++) { Start-Sleep 1; if (Test-Path $log) { try { $m = [regex]::Match((Get-Content $log -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $url = $m.Value } } catch { } } }
if (-not $url) { Stop-Process -Id $tun.Id -ErrorAction SilentlyContinue; Pausa 'Non riesco a creare il link (rete della scuola con firewall?). Riprova da un''altra rete.'; exit 1 }

Start-Sleep 3
Set-Clipboard -Value $url
$desk = [Environment]::GetFolderPath('Desktop'); Set-Content -LiteralPath (Join-Path $desk 'Omar AI - link online.txt') -Value "Link di Omar AI (valido finche' la finestra 'Omar AI - link online' resta aperta):`r`n$url`r`n" -Encoding UTF8
Start-Process $url
Write-Host "`n================================================================" -ForegroundColor Green
Write-Host "  LINK DI OMAR AI:  $url" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Copiato negli appunti e salvato sul Desktop ('Omar AI - link online.txt')."
Write-Host "  Funziona da qualsiasi PC o telefono finche' QUESTA finestra resta aperta e il PC acceso."
Write-Host "  Il link cambia a ogni avvio. Per spegnere tutto chiudi questa finestra.`n"
try { Wait-Process -Id $tun.Id } finally {
  Stop-Process -Id $tun.Id -ErrorAction SilentlyContinue
  taskkill /T /F /PID $omar.Id 2>$null | Out-Null
}
