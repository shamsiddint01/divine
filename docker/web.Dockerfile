# syntax=docker/dockerfile:1.7
# Divine.uz Web — statik SPA build + Nginx (non-root, 8080-port).
#   docker build -f docker/web.Dockerfile -t divine-web .

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY frontend/package.json frontend/
COPY shared/package.json shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@divine/frontend..."

COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend

# Brauzerga chiqadigan qiymatlar — secret emas. Standart: bir origin (/api/v1, Nginx proxy).
# VITE_API_MODE=http — haqiqiy backend. Image'ga `.env` kirmaydi (.dockerignore); ilgari qiymat berilmagani
# uchun SPA brauzer ichidagi mock API bilan yig'ilardi (Phase 16 topilmasi, SECURITY §19). `vite build`
# endi rejimsiz build'ni rad etadi; demo image kerak bo'lsa — `--build-arg VITE_API_MODE=mock`.
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_API_MODE=http
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_API_MODE=${VITE_API_MODE}
RUN pnpm --filter @divine/shared build && pnpm --filter @divine/frontend build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
# Production (docker-compose.prod.yml): TLS server blokidagi header'lar (+ HSTS) — prod.conf shu snippet'ni ishlatadi.
COPY docker/nginx/security-headers-tls.conf /etc/nginx/snippets/security-headers-tls.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
