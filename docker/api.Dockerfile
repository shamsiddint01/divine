# syntax=docker/dockerfile:1.7
# Divine.uz API — multi-stage image.
#   docker build -f docker/api.Dockerfile -t divine-api .
#   docker build -f docker/api.Dockerfile --target migrate -t divine-api-migrate .   (migrate deploy + seed)

ARG NODE_VERSION=24

# ─── base: pnpm (corepack, package.json'dagi packageManager versiyasi) ─────────
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ─── build: faqat @divine/backend va uning workspace dependencylari ───────────────
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY backend/package.json backend/
COPY shared/package.json shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@divine/backend..."

COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend

# prisma generate DB'ga ulanmaydi; URL faqat config validatsiyasi uchun.
RUN pnpm --filter @divine/shared build \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @divine/backend db:generate \
 && pnpm --filter @divine/backend build

# Faqat production dependencylar bilan mustaqil papka (/out).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @divine/backend --config.inject-workspace-packages=true deploy --prod /out

# ─── migrate: migratsiyalar + ma'lumotnoma seed'i (alohida bir martalik konteyner) ──
# Ilova ishga tushishidan OLDIN bajariladi (docs/DATABASE.md §8). Ikkala qadam ham idempotent.
# pnpm/corepack ish vaqtida CHAQIRILMAYDI: corepack pnpm'ni internetdan yuklashga urinadi, production'da esa
# migrate konteyneri internetsiz ichki tarmoqda (Phase 17 topilmasi). Prisma CLI va seed — to'g'ridan-to'g'ri;
# Prisma'ning update tekshiruvi (tarmoq) o'chirilgan. Root emas.
FROM build AS migrate
WORKDIR /app/backend
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
USER node
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/database/seed.cli.js"]

# ─── runtime: minimal, non-root ───────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
