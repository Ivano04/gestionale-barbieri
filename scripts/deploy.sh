#!/bin/bash
set -e

SERVER="root@178.104.235.228"
PROJECT_DIR="/opt/gestionale-parrucchiere"
SSH_KEY="$HOME/.ssh/hetzner_deploy_key"

echo "📦 Sincronizzazione file su $SERVER..."

tar czf - \
  --exclude='node_modules' \
  --exclude='./.next' \
  --exclude='./.git' \
  --exclude='./.env.local' \
  --exclude='*.log' \
  --exclude='*.png' \
  --exclude='*.yml' \
  --exclude='*.yaml' \
  --exclude='./supabase' \
  --exclude='./docs' \
  --exclude='./.claude' \
  --exclude='./.playwright-mcp' \
  --exclude='./.superpowers' \
  --exclude='./cache' \
  --exclude='./build' \
  --exclude='./dev' \
  --exclude='./trace' \
  --exclude='./turbopack' \
  --exclude='./settings.local.json' \
  . | ssh -i "$SSH_KEY" "$SERVER" "cd $PROJECT_DIR && tar xzf - && echo 'OK'"

# Transfer docker-compose.yml separately (excluded by *.yml)
scp -i "$SSH_KEY" docker-compose.yml "$SERVER:$PROJECT_DIR/docker-compose.yml"

echo "🔨 Rebuild e riavvio container Next.js..."
ssh -i "$SSH_KEY" "$SERVER" "cd $PROJECT_DIR && docker compose up --build -d --remove-orphans"

echo "🔄 Reload Caddy..."
ssh -i "$SSH_KEY" "$SERVER" "cd /opt/n8n-server && docker compose restart caddy"

echo "✅ Deploy completato: https://gestionale-parrucchiere.localvista.it"
