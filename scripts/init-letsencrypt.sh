#!/bin/bash
set -e

DOMAIN="gestionale-parrucchiere.localvista.it"
EMAIL="admin@localvista.it"
PROJECT_DIR="/opt/gestionale-parrucchiere"

cd "$PROJECT_DIR"

# 1. Crea config nginx temporanea (solo HTTP) per la challenge webroot
cat > nginx/init-http.conf << 'NGINX'
server {
    listen 80;
    server_name gestionale-parrucchiere.localvista.it;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 "init mode - certbot setup in progress";
    }
}
NGINX

# 2. Avvia nginx in modalità solo-HTTP
echo "🌐 Avvio Nginx in modalità HTTP..."
docker compose up -d nginx

# 3. Ottieni il certificato SSL
echo "🔒 Richiesta certificato Let's Encrypt per $DOMAIN..."
docker compose run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# 4. Ripristina config Nginx completa e riavvia
echo "🔁 Ripristino config HTTPS e riavvio Nginx..."
rm nginx/init-http.conf
docker compose restart nginx

echo "✅ Certificato SSL installato. Sito disponibile su https://$DOMAIN"
