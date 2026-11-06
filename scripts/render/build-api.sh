#!/usr/bin/env bash
# Render Web Service build'i (render.yaml, docs/RUNBOOK-RENDER.md). corepack'siz: pnpm versiyasi package.json bilan bir xil.
set -euo pipefail
pnpm() { npx --yes pnpm@11.21.0 "$@"; }

pnpm install --frozen-lockfile --prod=false --filter "@divine/backend..."
pnpm --filter @divine/shared build
# prisma generate DB'ga ulanmaydi; URL faqat config validatsiyasi uchun.
DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @divine/backend db:generate
pnpm --filter @divine/backend build
