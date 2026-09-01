# Decisions — MoonTV

> Accepted durable decisions and material rationale.

## D-001 — Adopt Agnir for Project continuity (2026-08-31)

- Adopted Agnir Core `0.1` with profile `repository-filesystem/0.1` for project-owned durable continuity.
- Rationale: make the Project resumable across Agents, conversations, and execution environments without depending on any single conversation or private Agent memory.
- Activation route: root `AGENTS.md` → `README.md` `## Agnir Project Instructions` → `AGNIR.yaml` → `.agnir/` memory.
- Identity: `urn:agnir:project:moontv`; canonical repository `MoonTechLab/LunaTV`; authoritative ref `desktop`.

## D-002 — Compatible operational upgrade to Agnir v0.1.0 (2026-09-01)

- Upgraded the applied Agnir operational package to stable release `v0.1.0` (source `iorLab/agnir`, immutable revision `2a0cb7bf2068b11f361e315670b2f2dc497b2588`).
- Classification: compatible operational upgrade — Core line remains `0.1`, profile remains `repository-filesystem/0.1`; Project identity, memory locators, and durable memory content preserved.
- Merged the commit-boundary checkpoint rule into `README.md` `## Agnir Project Instructions`; recorded operational provenance under `extensions.agnir/operations`.

## D-003 — Correct repository canonical to fork source (2026-09-01)

- Changed `agnir/repository.canonical` from `MoonTechLab/LunaTV` to `jaytantech3000/LunaTV` — the active `origin` remote where this work is actually pushed.
- Rationale: upstream is `MoonTechLab/LunaTV`, but the working repository and push target is the fork `jaytantech3000/LunaTV`; `canonical` now matches where `authoritative_ref: desktop` is published.
- Updated `.agnir/state.md` Identity to match.
