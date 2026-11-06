#!/usr/bin/env bash
# Render Static Site build'i (render.yaml, docs/RUNBOOK-RENDER.md). VITE_API_MODE=http — haqiqiy backend, /api/v1 bir origin.
set -euo pipefail
pnpm() { npx --yes pnpm@11.21.0 "$@"; }

pnpm install --frozen-lockfile --prod=false --filter "@divine/frontend..."
pnpm --filter @divine/shared build
pnpm --filter @divine/frontend build
