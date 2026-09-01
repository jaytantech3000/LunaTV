# Agnir compatible operational upgrade — 2026-09-01

- Previous baseline: Agnir Core `0.1` / `repository-filesystem/0.1`, initialized 2026-08-31 with no operational provenance recorded.
- Target: stable release `v0.1.0` (source `iorLab/agnir`, tag `v0.1.0`, immutable revision `2a0cb7bf2068b11f361e315670b2f2dc497b2588`).
- Classification: compatible operational upgrade (Core/profile lines unchanged; not a migration).
- Applied changes:
  - Added `extensions.agnir/operations` provenance to `AGNIR.yaml`.
  - Merged the commit-boundary checkpoint rule into `README.md` `## Agnir Project Instructions`.
  - Added decision D-002.
- Preserved: `project.identity` (`urn:agnir:project:moontv`), all memory locators, durable memory content, and the `agnir/repository` extension.
- Fresh activation result: Project root → `AGENTS.md` → `README.md` `## Agnir Project Instructions` → `AGNIR.yaml` → `.agnir/` memory — passed.
