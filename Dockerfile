# syntax=docker/dockerfile:1
# Dossier: the Fastify server with the built web app. Debian (glibc) base, because sharp's prebuilt binaries need
# glibc (no Alpine). Build: `docker build -t dossier .`; run: see docker-compose.yml and docs/WEB.md.

# --- build: install everything and build the web app into web/dist ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime: production dependencies, the server and the built web app ---
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4400 \
    DOSSIER_HOME=/workspace
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY bin bin
COPY src src
COPY assets assets
COPY workspace.example workspace.example
COPY --from=build /app/web/dist web/dist
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/dossier-entrypoint
RUN ln -s /app/bin/dossier.js /usr/local/bin/dossier \
    && ln -s /app/bin/dossier-mcp.js /usr/local/bin/dossier-mcp \
    && mkdir -p /workspace && chown node:node /workspace

# Unprivileged user from the base image (uid 1000).
USER node
VOLUME ["/workspace"]
EXPOSE 4400

# HOST=0.0.0.0 needs DOSSIER_ALLOWED_HOSTS (the server refuses to start without it). Any HTTP answer below 500 counts
# as healthy, so a 421 for a Host name outside DOSSIER_ALLOWED_HOSTS does not mark a running server unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4400) + '/api/me').then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["dossier-entrypoint"]
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
