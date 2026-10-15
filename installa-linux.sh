#!/usr/bin/env bash
# Installa Omar AI su Linux: copia l'app in ~/.local/share/omar-ai e crea l'icona nel menu e sul Desktop.
SRC="$(cd "$(dirname "$0")" && pwd)"; DEST="$HOME/.local/share/omar-ai"
[ -f "$SRC/package.json" ] || { echo "Estrai prima tutto lo .zip e lancia questo file dalla cartella estratta."; exit 1; }
mkdir -p "$DEST" "$HOME/.local/share/applications"
rsync -a --exclude data --exclude node_modules --exclude .env "$SRC/" "$DEST/" 2>/dev/null || cp -r "$SRC/." "$DEST/"
chmod +x "$DEST/avvia-omar.sh"
F="$HOME/.local/share/applications/omar-ai.desktop"
cat > "$F" <<EOT
[Desktop Entry]
Type=Application
Name=Omar AI
Comment=Tutor IA dell'ITIS Omar
Exec=$DEST/avvia-omar.sh
Icon=$DEST/public/img/logo.png
Terminal=true
Categories=Education;
EOT
chmod +x "$F"
D=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop"); [ -d "$D" ] && cp "$F" "$D/" && chmod +x "$D/omar-ai.desktop" && (gio set "$D/omar-ai.desktop" metadata::trusted true 2>/dev/null || true)
echo "Fatto! Trovi \"Omar AI\" nel menu delle applicazioni e sul Desktop."
