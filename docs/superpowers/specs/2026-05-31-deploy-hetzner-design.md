# Deploy gestionale-parrucchiere su Hetzner

**Data:** 2026-05-31
**Stato:** Approvato

---

## Contesto

Progetto Next.js 16.2.6 (App Router) + React 19 + Tailwind CSS 4 da deployare su server Hetzner con Docker/Docker Compose. Il database e auth sono su Supabase Cloud (progetto creato). Deploy manuale: build in locale, sincronizzazione file via rsync, avvio container sul server.

---

## Dati server

| Campo | Valore |
|-------|--------|
| **IP** | `178.104.235.228` |
| **Dominio** | `gestionale-parrucchiere.localvista.it` |
| **Sistema** | Linux con Docker e Docker Compose |
| **Percorso app** | `/opt/gestionale-parrucchiere/` |

---

## Dati Supabase Cloud

Le credenziali vanno inserite nel file `.env.production` sul server (MAI committare in git):

```
NEXT_PUBLIC_SUPABASE_URL=https://<tuo-progetto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

Recuperabili dalla dashboard Supabase → Settings → API.

---

## Architettura

```
                        Internet
                           │
                           ▼
                    ┌─────────────┐
                    │   Nginx      │  reverse proxy + HTTPS
                    │  :80 :443   │
                    └──────┬──────┘
                           │ proxy_pass http://nextjs:3000
                           ▼
                    ┌─────────────┐
                    │   Next.js    │  container Docker, porta 3000 interna
                    │  standalone  │
                    └──────┬──────┘
                           │ HTTP API calls
                           ▼
                    ┌─────────────┐
                    │  Supabase    │  Cloud (managed) — DB, Auth, API
                    │   Cloud      │
                    └─────────────┘

                    ┌─────────────┐
                    │   Certbot    │  si attiva on-demand per rinnovo SSL
                    └─────────────┘
```

Tre container Docker orchestrati via `docker-compose.yml`:
- **nextjs**: app Next.js in modalità standalone, esposizione porta 3000 (interna)
- **nginx**: reverse proxy, termina HTTPS, rinnovo automatico certificati
- **certbot**: genera e rinnova certificato Let's Encrypt via webroot challenge

---

## File da creare

Tutti i file sono nuovi, nessun file esistente viene modificato eccetto `next.config.ts`.

```
progetto/
├── docker-compose.yml
├── Dockerfile
├── .dockerignore
├── .env.production           ← creato SOLO sul server, MAI committato
├── nginx/
│   └── default.conf
└── scripts/
    ├── init-letsencrypt.sh
    └── deploy.sh
```

---

## Dockerfile — multi-stage

- **Stage deps**: `node:22-alpine`, copia `package.json` e `package-lock.json`, `npm ci --omit=dev`
- **Stage builder**: `node:22-alpine`, installa tutte le dipendenze, `next build` con output standalone
- **Stage runner**: `node:22-alpine`, copia solo i file necessari dagli stage precedenti, `CMD ["node", "server.js"]`

L'output standalone di Next.js include tutte le dipendenze necessarie, incluso il server Node.js, in un unico bundle eseguibile.

---

## docker-compose.yml

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
    networks:
      - app-network

  certbot:
    image: certbot/certbot
    volumes:
      - certbot-www:/var/www/certbot
      - certbot-conf:/etc/letsencrypt
    entrypoint: ""  # si esegue on-demand, non resta in esecuzione
    networks:
      - app-network

networks:
  app-network:

volumes:
  certbot-www:
  certbot-conf:
```

---

## Nginx default.conf

Due server block:
- **HTTP (porta 80)**: reindirizza tutto a HTTPS tranne `/.well-known/acme-challenge/` che serve i file certbot
- **HTTPS (porta 443)**: reverse proxy verso `nextjs:3000` con header `X-Forwarded-Proto`, `X-Real-IP`, `X-Forwarded-For`. `proxy_buffering off` per compatibilità con SSR/streaming di Next.js

Certificati SSL puntano a:
- `/etc/letsencrypt/live/gestionale-parrucchiere.localvista.it/fullchain.pem`
- `/etc/letsencrypt/live/gestionale-parrucchiere.localvista.it/privkey.pem`

TLS 1.2 e 1.3, cipher moderni.

---

## Scripts

### `deploy.sh` (eseguito localmente)

Singolo comando per aggiornare il server:
```bash
./scripts/deploy.sh
```

Operazioni:
1. `rsync -avz --delete` dei file sorgente (esclude `node_modules`, `.next`, `.git`, `.env.local`, log, png, yml)
2. SSH sul server: `docker compose up --build -d --remove-orphans`

### `init-letsencrypt.sh` (eseguito sul server, solo primo deploy)

1. Avvia nginx in modalità HTTP (config temporanea)
2. Lancia certbot in modalità webroot per ottenere il certificato
3. Riavvia nginx con la config HTTPS completa

---

## Modifiche a next.config.ts

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

Aggiunta dell'opzione `output: "standalone"` per generare il bundle standalone usato dal Dockerfile.

---

## .env.production (solo sul server, mai in git)

```
NEXT_PUBLIC_SUPABASE_URL=https://<tuo-progetto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

---

## Configurazione Supabase Cloud

Nella dashboard Supabase, **Authentication → URL Configuration**:

| Campo | Valore |
|-------|--------|
| Site URL | `https://gestionale-parrucchiere.localvista.it` |
| Redirect URLs | `https://gestionale-parrucchiere.localvista.it/**` |

---

## Migrazioni database

I 5 file in `supabase/migrations/` vanno eseguiti in ordine numerico nella SQL Editor della dashboard Supabase Cloud:

1. `001_initial_schema.sql`
2. `002_add_working_hours.sql`
3. `003_users_update_policy.sql`
4. `004_service_phases_overrides.sql`
5. `005_waitlist_notifications.sql`

---

## Ordine operazioni primo deploy

1. **Locale**: modificare `next.config.ts` (output standalone)
2. **Locale**: creare i file Docker (Dockerfile, docker-compose.yml, .dockerignore, nginx/default.conf, scripts/)
3. **Locale + commit**: committare tutto (tranne `.env.production`)
4. **Server**: creare cartella `/opt/gestionale-parrucchiere/`
5. **Locale → Server**: `rsync` dei file
6. **Server**: creare `.env.production` con le credenziali reali
7. **Server**: lanciare `init-letsencrypt.sh`
8. **Server**: `docker compose up -d`
9. **Dashboard Supabase**: configurare redirect URL
10. **Dashboard Supabase**: eseguire le migrazioni in SQL Editor
11. **Verifica finale**: HTTPS funzionante, auth OK, API OK

---

## Deploy successivi

```bash
./scripts/deploy.sh
```

Unico comando: rsync + rebuild + riavvio container.

---

## Rollback

I container vecchi vengono rimossi da `docker compose up --remove-orphans`. Per rollback:
- Fare revert del commit in locale
- Rieseguire `deploy.sh`
