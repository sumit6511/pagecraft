# syntax=docker/dockerfile:1

# ── Build ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Runtime: Node plus the document converters the server tools call ────────
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      ghostscript qpdf ocrmypdf tesseract-ocr-eng \
      fonts-dejavu fonts-liberation fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=25s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps the LibreOffice/Ghostscript child processes.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
