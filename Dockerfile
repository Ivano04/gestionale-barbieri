# Stage 1: installazione unica delle dipendenze
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

# Stage 2: build Next.js con output standalone
FROM deps AS builder
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

# Dipendenze runtime indipendenti dal codice: riutilizzabili tra i rilasci.
FROM deps AS production-deps
RUN npm prune --omit=dev --legacy-peer-deps --no-audit --no-fund

# Stage 3: immagine finale leggera
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Solo la cache e gli artefatti Next richiedono scrittura a runtime.
# Non ricopiare tutte le dipendenze in un secondo strato per cambiarne il proprietario.
RUN mkdir -p /app/.next/cache && chown -R nextjs:nodejs /app/.next

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
