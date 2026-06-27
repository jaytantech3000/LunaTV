# GitHub High-Star Music Player Research

**Purpose**

Provide reference samples for LunaTV music-player scoping and architecture split, with focus on cross-platform delivery, plugin-based music sources, Web/Electron shells, local media libraries, and player interaction design.

**Data Notes**

- Snapshot date: 2026-06-28
- Sources: GitHub repository metadata and README files
- Star counts, release cadence (发布节奏), and activity can change continuously, so this document reflects only the current snapshot

**Summary**

- If we read only 3 projects: `Spotube`, `YesPlayMusic`, `MusicFree`
- For desktop architecture first: `YesPlayMusic`, `Nuclear`
- For plugin-based source architecture first: `MusicFree`, `Spotube`
- For Android local-library work first: `Auxio`
- For historical interaction reference: `ViMusic`, but it should not be the current baseline

**Primary Samples**

| Project                                                         |  Stars | Latest release / activity                                         | Tech / platform                                 | Best thing to study                                                                                                 | Risk / note                                                                          |
| --------------------------------------------------------------- | -----: | ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [KRTirtho/spotube](https://github.com/KRTirtho/spotube)         | 47,171 | `v5.1.2`, 2026-06-05; latest code push 2026-06-05                 | Flutter; desktop + mobile                       | Plugin-powered source abstraction (音源抽象), one cross-platform player shell, layered lyrics/download capabilities | License metadata is not explicit; confirm manually before any code reuse             |
| [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic) | 32,982 | latest release `v0.4.10`, 2025-10-09; latest code push 2026-06-14 | Vue + Electron + PWA; desktop + web             | Reusing a web stack inside a desktop player, one shared UI system for shell and pages                               | Assumptions are tied closely to the NetEase ecosystem and should not be copied as-is |
| [maotoumao/MusicFree](https://github.com/maotoumao/musicfree)   | 25,376 | latest release `v0.6.2`, 2025-10-11; latest code push 2026-06-20  | React Native + TypeScript; Android / Harmony    | Decoupling (解耦) player core from source plugins, theme/customization support, plugin contract (插件契约) design   | `AGPL-3.0`; direct code reuse has strong reciprocal obligations                      |
| [nukeop/nuclear](https://github.com/nukeop/nuclear)             | 17,909 | `player@1.41.0`, 2026-06-21; latest code push 2026-06-27          | Tauri + React + Rust; desktop                   | Desktop modularization (模块化), plugin-store direction, Rust + Web UI boundaries                                   | The architecture is heavier and not ideal as a minimal starter sample                |
| [OxygenCobalt/Auxio](https://github.com/OxygenCobalt/Auxio)     |  3,956 | `v4.1.0`, 2026-06-15; latest code push 2026-06-24                 | Kotlin + Media3/ExoPlayer; Android local player | Clean local-library architecture, tag parsing, practical Android playback structure                                 | It does not cover plugin-based sources or cross-platform delivery                    |
| [Taiko2k/Tauon](https://github.com/Taiko2k/Tauon)               |  2,706 | `v10.0.1`, 2026-05-29; latest code push 2026-06-26                | Desktop local-library player; Linux / Windows   | Local-library UX, media-server integration (整合), collection management                                            | Better for local-library direction than for plugin-based streaming architecture      |

**Supplemental and Historical References**

| Project                                                             | Stars | Status                                                            | Good for                                                                      | Note                                                                                               |
| ------------------------------------------------------------------- | ----: | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [vfsfitvnm/ViMusic](https://github.com/vfsfitvnm/ViMusic)           | 9,452 | Archived; last code push 2024-07-15                               | Android music-player interaction and mobile visual language                   | Good for interaction study only, not as a current technical baseline                               |
| [harmonoid/harmonoid](https://github.com/harmonoid/harmonoid)       | 4,609 | latest release `v0.3.22`, 2026-01-28; latest code push 2026-06-27 | Cross-platform local library, lyrics, tags, unified desktop/mobile experience | License metadata is not explicit; verify separately before reuse                                   |
| [anandnet/Harmony-Music](https://github.com/anandnet/Harmony-Music) | 3,042 | latest release `v1.12.2`, 2025-12-07; latest code push 2025-12-08 | Flutter cross-platform streaming shell                                        | Useful as a supplemental sample, but maintenance cadence (维护节奏) is weaker than the primary set |

**Scenario Picks**

- For a `Web/Electron` player:
  - read `YesPlayMusic` first
  - then read `Nuclear`
  - focus on the player shell, queue panel, desktop packaging, and web reuse boundaries
- For a plugin-based source architecture:
  - read `MusicFree` first
  - then read `Spotube`
  - focus on the plugin contract, source capability declarations, and decoupling between player core and provider layers
- For a single-codebase cross-platform player:
  - read `Spotube` first
  - then read `harmonoid`
  - focus on how desktop and mobile share one playback domain model (领域模型)
- For an Android local media library:
  - read `Auxio` first
  - then read `ViMusic`
  - use the former for structure and the latter for interaction

**Architecture Practices Worth Reusing**

- `Adapter Pattern` + `Strategy Pattern`:
  - each source should expose one unified capability interface such as `search`, `playlist`, `stream`, `lyrics`, and `download`
  - the UI should not contain many `if source === xxx` branches
- Capability flags instead of hardcoding:
  - use capability flags to describe whether a source can search, play, download, or provide lyrics
  - pages should render from capabilities rather than from one platform's hardcoded behavior
- Decouple player core from source layers:
  - queue items, playback state, and lyric state should use a normalized domain model (标准化领域模型)
  - do not inject one provider's raw fields directly into the global player store
- Upstream degradation (上游降级):
  - prefer a circuit breaker (熔断), short-TTL health cache, and automatic fallback (回退)
  - this is more robust than enabling a source only because an environment variable exists
- Separate shell from engine:
  - the mini player, fullscreen player, queue, and lyrics panels should consume stable player state
  - source plugins should not mutate local UI component state directly

**What We Should Not Copy**

- Do not turn a third-party platform's business fields into the global playback model
- Do not connect page components directly to every source SDK or HTTP detail
- Do not keep showing a source entry that is configured but already unavailable
- Do not copy code from `AGPL` or `GPL` projects before checking license impact and compliance (合规) obligations

**Direct Recommendation for LunaTV**

- If LunaTV stays web-first, the first reference target should be `YesPlayMusic`
- If LunaTV needs multiple sources plus graceful degradation, the first reference targets should be `MusicFree` and `Spotube`
- If LunaTV later adds a desktop client, `Nuclear` is more useful than a simple Electron sample for module boundaries
- If the immediate goal is only to make the current player experience stable and clear, absorb shell organization from `YesPlayMusic` first and then borrow mobile interaction ideas from `ViMusic`
