#!/usr/bin/env bash
# Installa Omar AI su macOS: copia l'app in ~/Applications/OmarAI e crea "Omar AI" sul Desktop.
SRC="$(cd "$(dirname "$0")" && pwd)"; DEST="$HOME/Applications/OmarAI"
[ -f "$SRC/package.json" ] || { echo "Estrai prima tutto lo .zip e apri questo file dalla cartella estratta."; read -r; exit 1; }
mkdir -p "$DEST"
rsync -a --exclude data --exclude node_modules --exclude .env "$SRC/" "$DEST/"
chmod +x "$DEST/avvia-omar.sh"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
L="$HOME/Desktop/Omar AI.command"
printf '#!/usr/bin/env bash\nexec "%s/avvia-omar.sh"\n' "$DEST" > "$L"; chmod +x "$L"
echo "Fatto! Sul Desktop trovi \"Omar AI\". Servono Node.js (https://nodejs.org) e Ollama (https://ollama.com)."
read -r -p "Avvio Omar AI adesso? [s/N] " r; [ "$r" = "s" ] && exec "$DEST/avvia-omar.sh"
