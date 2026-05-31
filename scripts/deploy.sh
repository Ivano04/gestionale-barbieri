#!/bin/bash
set -e

SERVER="root@178.104.235.228"
PROJECT_DIR="/opt/gestionale-parrucchiere"

echo "📦 Sincronizzazione file su $SERVER..."

rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude '.env.local' \
  --exclude '*.log' \
  --exclude '*.png' \
  --include 'docker-compose.yml' \
  --exclude '*.yml' \
  ./ "$SERVER:$PROJECT_DIR/"

echo "🔨 Rebuild e riavvio container..."
ssh "$SERVER" "cd $PROJECT_DIR && docker compose up --build -d --remove-orphans"

echo "✅ Deploy completato: https://gestionale-parrucchiere.localvista.it"
