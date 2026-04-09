#!/usr/bin/env bash
set -e
DATA_DIR="${DATA_DIR:-/root/panel-data}"
LEGACY_DIR="${1:-/root/metin2-panel-bot/data}"
mkdir -p "$DATA_DIR"
for file in config.json stats.json badges.json; do
  if [ -f "$LEGACY_DIR/$file" ] && [ ! -f "$DATA_DIR/$file" ]; then
    cp "$LEGACY_DIR/$file" "$DATA_DIR/$file"
  fi
done
echo "Eski veriler tasindi: $DATA_DIR"
