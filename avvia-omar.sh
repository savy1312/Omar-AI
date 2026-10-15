#!/usr/bin/env bash
# Avvio di Omar AI su macOS e Linux (su Windows usa avvia-omar.bat).
set -e
cd "$(dirname "$0")"
PORT=$( [ -f .env ] && grep -E '^PORT=' .env | cut -d= -f2 || true ); PORT=${PORT:-3300}; URL="http://localhost:$PORT"
apri() { node scripts/apri-finestra.js "$PORT" & }
if curl -s -o /dev/null --max-time 2 "$URL/api/info"; then apri; exit 0; fi   # gia' acceso: apro solo la finestra
command -v node >/dev/null || { echo "Node.js 22.13 o successivo non trovato. Installalo da https://nodejs.org"; exit 1; }
[ -d node_modules ] || { echo "Installo le dipendenze..."; npm install; }
[ -f .env ] || cp .env.example .env
echo "Collego Ollama..."
npm run setup:ollama || { echo; echo "Collegamento a Ollama non riuscito: leggi sopra."; exit 1; }
apri   # apre la finestra appena il server risponde
echo; echo "Omar AI e' acceso su $URL - NON chiudere questa finestra: chiudendola Omar si spegne."; echo
npm start
