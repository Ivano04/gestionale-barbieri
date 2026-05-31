# Deploy gestionale-parrucchiere su Hetzner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creare tutti i file necessari per il deploy Docker su Hetzner e verificare che la build funzioni localmente.

**Architecture:** Docker Compose con 3 servizi — nextjs (Next.js standalone), nginx (reverse proxy HTTPS), certbot (Let's Encrypt). Deploy manuale via rsync + docker compose rebuild.

**Tech Stack:** Next.js 16 (standalone output), Docker multi-stage, Nginx Alpine, Certbot, rsync

---

## File Structure

```
progetto/
├── next.config.ts           ← MODIFICA: aggiungere output: "standalone"
├── Dockerfile               ← CREATE: multi-stage build
├── docker-compose.yml       ← CREATE: orchestrazione 3 servizi
├── .dockerignore            ← CREATE: esclusioni build Docker
├── nginx/
│   └── default.conf         ← CREATE: reverse proxy HTTP + HTTPS
└── scripts/
    ├── deploy.sh            ← CREATE: rsync + rebuild remoto
    └── init-letsencrypt.sh  ← CREATE: primo certificato SSL
```

---

### Task 1: Modifica next.config.ts per output standalone

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Aggiungere `output: "standalone"`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Commit**

```bash
git add next.config.ts
git commit -m "feat: abilita output standalone Next.js per deploy Docker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Crea .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Scrivere il file**

```
node_modules
.next
.git
.env.local
.env
*.log
*.png
*.yml
*.yaml
!docker-compose.yml
docs
.claude
.playwright-mcp
.superpowers
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "feat: aggiunge .dockerignore per escludere file non necessari dal build Docker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Crea Dockerfile multi-stage

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Scrivere il Dockerfile**

```dockerfile
# Stage 1: installazione dipendenze di produzione
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: build Next.js con output standalone
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: immagine finale leggera
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "feat: aggiunge Dockerfile multi-stage per Next.js standalone

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Crea docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Scrivere il docker-compose**

```yaml
services:
  nextjs:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - certbot-www:/var/www/certbot:ro
      - certbot-conf:/etc/letsencrypt:ro
    depends_on:
      - nextjs
    restart: unless-stopped
    networks:
      - app-network

  certbot:
    image: certbot/certbot
    volumes:
      - certbot-www:/var/www/certbot
      - certbot-conf:/etc/letsencrypt
    entrypoint: ""
    networks:
      - app-network

networks:
  app-network:

volumes:
  certbot-www:
  certbot-conf:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: aggiunge docker-compose.yml con nextjs + nginx + certbot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Crea configurazione Nginx

**Files:**
- Create: `nginx/default.conf`

- [ ] **Step 1: Creare cartella nginx**

```bash
mkdir -p nginx
```

- [ ] **Step 2: Scrivere default.conf**

```nginx
server {
    listen 80;
    server_name gestionale-parrucchiere.localvista.it;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name gestionale-parrucchiere.localvista.it;

    ssl_certificate     /etc/letsencrypt/live/gestionale-parrucchiere.localvista.it/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gestionale-parrucchiere.localvista.it/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://nextjs:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add nginx/default.conf
git commit -m "feat: aggiunge config Nginx reverse proxy con HTTPS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Crea script deploy.sh

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Creare cartella scripts**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Scrivere deploy.sh**

```bash
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
  --exclude '*.yml' \
  --exclude '!docker-compose.yml' \
  ./ "$SERVER:$PROJECT_DIR/"

echo "🔨 Rebuild e riavvio container..."
ssh "$SERVER" "cd $PROJECT_DIR && docker compose up --build -d --remove-orphans"

echo "✅ Deploy completato: https://gestionale-parrucchiere.localvista.it"
```

- [ ] **Step 3: Rendere eseguibile lo script**

```bash
chmod +x scripts/deploy.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: aggiunge script deploy.sh per deploy manuale con rsync

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Crea script init-letsencrypt.sh

**Files:**
- Create: `scripts/init-letsencrypt.sh`

- [ ] **Step 1: Scrivere init-letsencrypt.sh**

```bash
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
```

- [ ] **Step 2: Rendere eseguibile lo script**

```bash
chmod +x scripts/init-letsencrypt.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/init-letsencrypt.sh
git commit -m "feat: aggiunge script init-letsencrypt.sh per primo certificato SSL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Test build Docker locale

**Files:**
- Nessuna modifica — solo verifica

- [ ] **Step 1: Creare `.env.production` temporaneo per il test**

```bash
echo 'NEXT_PUBLIC_SUPABASE_URL=https://<tuo-progetto>.supabase.co' > .env.production
echo 'NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...' >> .env.production
echo 'SUPABASE_SERVICE_ROLE_KEY=sb_secret_...' >> .env.production
```

- [ ] **Step 2: Build Docker locale**

Esegui: `docker compose build`

Expected: BUILD SUCCESS — tutti e 3 gli stage completano senza errori.

- [ ] **Step 3: Avvio locale e verifica**

Esegui: `docker compose up -d`

Poi: `docker compose ps`
Expected: il servizio `nextjs` è "Up" e healthy.

Poi: `docker compose logs nextjs`
Expected: vedere log di avvio Next.js, tipo "Ready in Xms" o "Listening on port 3000".

- [ ] **Step 4: Test HTTP locale**

Esegui: `curl -I http://localhost:80`
Expected: HTTP 301 redirect a HTTPS.

- [ ] **Step 5: Pulizia**

```bash
docker compose down
rm .env.production
```

**NOTA:** `.env.production` NON va committato. Questo file esiste solo sul server in produzione.

---

## Self-Review

1. **Spec coverage:** Ogni elemento della spec ha un task corrispondente:
   - next.config.ts → Task 1
   - Dockerfile → Task 3
   - docker-compose.yml → Task 4
   - .dockerignore → Task 2
   - nginx/default.conf → Task 5
   - deploy.sh → Task 6
   - init-letsencrypt.sh → Task 7
   - Test build → Task 8

2. **Placeholder scan:** Nessun "TBD" o "TODO". Tutti i path, comandi e codice sono espliciti.

3. **Type consistency:** I nomi dei servizi (`nextjs`, `nginx`, `certbot`), le porte (3000, 80, 443), i volumi (`certbot-www`, `certbot-conf`) e la rete (`app-network`) sono coerenti tra tutti i task.

---

## Ordine operazioni sul server (primo deploy)

Dopo aver completato tutti i task e pushato su GitHub:

1. SSH sul server: `ssh root@178.104.235.228`
2. `mkdir -p /opt/gestionale-parrucchiere`
3. In locale: `rsync` dei file (senza `.env.production`)
4. Sul server: creare `.env.production` con le credenziali reali
5. Sul server: `chmod +x scripts/init-letsencrypt.sh && ./scripts/init-letsencrypt.sh`
6. Sul server: `docker compose up -d`
7. Dashboard Supabase: configurare redirect URL
8. Dashboard Supabase SQL Editor: eseguire migrazioni in ordine
9. Verifica: `https://gestionale-parrucchiere.localvista.it`

