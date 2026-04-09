#!/usr/bin/env bash
set -e
cd /root
ZIP="${1:-metin2-panel-bot-v18.5.5-visual-cleanup-rainbow-fix-fixed.zip}"
TARGET="/root/metin2-panel-bot"
WORK="/tmp/metin2-panel-install"
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p /root/metin2-panel-backups
rm -rf "$WORK"
mkdir -p "$WORK"

# keep data and env from current install if they exist
if [ -d "$TARGET" ]; then
  mkdir -p "/root/metin2-panel-backups/$STAMP"
  [ -d "$TARGET/data" ] && cp -a "$TARGET/data" "/root/metin2-panel-backups/$STAMP/data" || true
  [ -f "$TARGET/.env" ] && cp -f "$TARGET/.env" "/root/metin2-panel-backups/$STAMP/.env" || true
  mv "$TARGET" "/root/metin2-panel-backups/$STAMP/old-panel" || true
fi

unzip -oq "$ZIP" -d "$WORK"
mkdir -p "$TARGET"
if [ -d "$WORK/metin2-panel-bot" ]; then
  cp -a "$WORK/metin2-panel-bot/." "$TARGET/"
else
  cp -a "$WORK/." "$TARGET/"
fi

# restore preserved data and env if available
if [ -d "/root/metin2-panel-backups/$STAMP/data" ]; then
  rm -rf "$TARGET/data"
  cp -a "/root/metin2-panel-backups/$STAMP/data" "$TARGET/data"
fi
if [ -f "/root/metin2-panel-backups/$STAMP/.env" ]; then
  cp -f "/root/metin2-panel-backups/$STAMP/.env" "$TARGET/.env"
fi

cd "$TARGET"
npm install >/dev/null 2>&1 || npm install
pm2 delete metin2-panel >/dev/null 2>&1 || true
pm2 start server.js --name metin2-panel
pm2 save

echo "Kurulum tamam"
echo "Yedek klasoru: /root/metin2-panel-backups/$STAMP"
pm2 status
pm2 logs metin2-panel --lines 25 --nostream
