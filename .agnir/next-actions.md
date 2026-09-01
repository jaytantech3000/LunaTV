# Next Actions — MoonTV

> Outstanding work, blockers, priorities, and intentional deferrals. Reconcile at each checkpoint.

## Before desktop release

- [ ] Windows desktop playback comparison: verify VOD prefetch enabled vs disabled against actual playback before release (from `FeatureLog.md`, 2026-08-06).

## Desktop download / offline playback

- [ ] Continue moving download task execution into the Rust sidecar (`crates/moontv-local-service`). Current boundary: the frontend still schedules tasks and computes progress; the sidecar owns storage and playback.

## Agnir bootstrap

- [ ] At the first intentional checkpoint after continued work, reconcile this file and `.agnir/state.md` with present Project truth.
