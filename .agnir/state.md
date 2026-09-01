# Current State — MoonTV

> Authoritative current truth. Load with `AGNIR.yaml` before Project work; prefer it over chat history or private Agent memory unless superseded by a newer Principal instruction or directly observed current Project fact.

## Identity

- Project: MoonTV (npm package `moontv`)
- Canonical repository: `MoonTechLab/LunaTV`
- Authoritative branch: `desktop`
- Agnir identity: `urn:agnir:project:moontv`

## What this Project is

MoonTV is a cross-platform media-aggregation player: multi-source search, detail pages, online playback, favorites + play history, admin, and offline download + offline playback.

## Stack

- Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Zustand, ArtPlayer, HLS.js, next-pwa
- Rust desktop sidecar: `crates/moontv-local-service` (Tauri desktop)

## Active development line

- Branch `desktop` — desktop local download runtime, online VOD cache, and VOD prefetch.
- Most recent merged features (see `FeatureLog.md`):
  - Desktop online VOD cache (async disk cache; 512 MiB total / 32 MiB per asset / 4 writers; manifests 15s TTL, keys 1h, segments 24h, LRU eviction).
  - Desktop active VOD prefetch (off / 30s / 1min / full-episode; persistent player setting defaults off).

## Hard constraints (do not regress)

- VOD playback must remain on the same-origin proxy URL. `/play`, speed test, source switch, and offline playback must not fall back to raw upstream m3u8.
- Web offline playback depends on three coupled layers: Cache Storage, resource index (IndexedDB), Service Worker. Changing only one usually leaves latent faults.
- `next.config.js` excludes `/api/proxy/vod/*` from next-pwa's generic API runtime caching; the custom Service Worker (`worker/index.ts`) owns that route.
- Video-source config shape changes are multi-point: `src/lib/config.ts`, `src/lib/admin.types.ts`, `src/lib/downstream.ts`, `src/app/api/admin/source/route.ts`, `src/app/admin/page.tsx`.

## Local development

- Package manager: `pnpm`.
- Dev: `pnpm dev` · Typecheck: `pnpm typecheck` · Lint: `pnpm lint` / `pnpm lint:strict` · Tests: `pnpm test`.
- Offline download/playback verification: `pnpm preview:offline` (`pnpm dev` does not provide the full offline cache chain).
