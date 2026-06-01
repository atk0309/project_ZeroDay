FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY app ./app
COPY web ./web
RUN npx tsc -p tsconfig.json

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY web ./web
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
