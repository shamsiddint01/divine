#!/usr/bin/env bash
# Render Static Site build'i: superadmin paneli (render.yaml). Sahifa nomi Render'dagi SPA rewrite uchun index.html.
set -euo pipefail
pnpm() { npx --yes pnpm@11.21.0 "$@"; }

pnpm install --frozen-lockfile --prod=false --filter "@divine/frontend..."
pnpm --filter @divine/shared build
pnpm --filter @divine/frontend exec vite build --config vite.superadmin.config.ts
mv frontend/dist-superadmin/superadmin.html frontend/dist-superadmin/index.html
