#!/usr/bin/env bash
set -e
DATA_DIR="${DATA_DIR:-/root/panel-data}"
BACKUP_DIR="$DATA_DIR/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
cp -f "$DATA_DIR/config.json" "$BACKUP_DIR/config-$STAMP.json" 2>/dev/null || true
cp -f "$DATA_DIR/stats.json" "$BACKUP_DIR/stats-$STAMP.json" 2>/dev/null || true
cp -f "$DATA_DIR/badges.json" "$BACKUP_DIR/badges-$STAMP.json" 2>/dev/null || true
echo "Yedek alindi: $BACKUP_DIR"
