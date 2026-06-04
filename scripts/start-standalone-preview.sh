#!/bin/sh

set -eu

if [ -f ./.env.local ]; then
  set -a
  . ./.env.local
  set +a
fi

mkdir -p .next-build/standalone/.next-build
rm -rf .next-build/standalone/public .next-build/standalone/.next-build/static
cp -R public .next-build/standalone/public
cp -R .next-build/static .next-build/standalone/.next-build/static

PORT="${LUNATV_PORT:-3000}" HOSTNAME="${LUNATV_HOSTNAME:-0.0.0.0}" \
  node .next-build/standalone/server.js
