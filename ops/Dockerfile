FROM node:24.18.0-bookworm@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059 AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.json ./
COPY app ./app
COPY web ./web
RUN npm run build

FROM deps AS prod-deps
# Native modules were already compiled under the reviewed install-script policy
# in the deps stage. Pruning must not invoke lifecycle scripts a second time.
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/atk0309/project_ZeroDay" \
      org.opencontainers.image.licenses="MIT"
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json LICENSE ./
# import.meta-relative paths in compiled route modules resolve this tree under
# /app/dist/web, not /app/web.
COPY web ./dist/web
# migrate.js reads schema.sql relative to its own location (import.meta.url).
# In dist that's /app/dist/app/src/db/schema.sql. Without this file additive
# ALTER TABLE migrations (e.g. cheat_strikes.submitted_flag) never run in
# production, and module-load db.prepare() in lib/cheat.ts crashes the boot.
COPY app/src/db/schema.sql ./dist/app/src/db/schema.sql
# Stage 17 (stego-static) reads assets/c17/cover.png at module load via a path
# resolved four levels up from the compiled handler — i.e. /app/dist/assets/...
# in this image. Copy the repo's top-level assets/ tree into that location so
# the import.meta-relative resolver finds the cover PNG in production.
COPY assets ./dist/assets
RUN mkdir -p /data
EXPOSE 3000
# Run additive migrations before the server boots, mirroring `npm start` in
# dev. The compiled migrate.js is idempotent — safe to run on every deploy.
CMD ["sh", "-c", "node dist/app/src/db/migrate.js && exec node dist/app/src/server.js"]
