# Agnir compatibility-line migration 0.1 → 1.0 — 2026-09-07

- Authorization: Principal requested updating Agnir to the latest version; the latest stable release is `v1.0.0` (source `iorLab/agnir`, tag `v1.0.0`, immutable revision `6d16dcfd17b8e9f22fd25804e22b9f8a516d06c3`).
- Previous baseline: Core/profile `0.1`, operational release `0.1.0`, applied revision `2a0cb7bf2068b11f361e315670b2f2dc497b2588`.
- Boundary 1 — Core/profile `0.1` → `0.2` migration (`spec/CORE_0_1_TO_0_2_MIGRATION.md`):
  - Preserved Project identity, all memory locators, and all durable memory content.
  - The single implicit continuity line became exactly one logical Continuity Lineage: `urn:agnir:lineage:moontv-default`.
  - Candidate validated against `schemas/agnir-manifest-0.2.schema.json` — passed.
- Boundary 2 — Core/profile `0.2` → `1.0` promotion (`spec/CORE_0_2_TO_1_0_PROMOTION.md`):
  - Preserved `project.identity` and `continuity.lineage` exactly; memory, policy, and unrelated extensions untouched.
  - Compatibility declarations changed to `agnir.version: "1.0"` / `discovery_profile: "repository-filesystem/1.0"`.
  - Candidate validated against `schemas/agnir-manifest-1.0.schema.json` — passed.
- `extensions.agnir/operations` updated: release `1.0.0`, applied revision `6d16dcfd17b8e9f22fd25804e22b9f8a516d06c3`.
- README `## Agnir Project Instructions` merged non-destructively: compatibility identifiers updated, lineage validation added, commit-and-push wording refined to destination-ref verification.
- Fresh activation: Project root → `AGENTS.md` → `README.md` `## Agnir Project Instructions` → `AGNIR.yaml` (Core `1.0`, lineage `urn:agnir:lineage:moontv-default`) → `.agnir/` memory — passed.
