# GitHub 高星音乐播放器项目调研

**目标**

为 LunaTV 后续音乐播放器能力选型与架构拆分提供参考样本，重点关注跨端、插件化音源、Web/Electron 桌面壳、本地媒体库与播放器交互设计。

**数据说明**

- 快照时间：2026-06-28
- 数据来源：GitHub 仓库元数据与 README
- 星数、发布节奏和活跃度会持续变化，本文只代表当前时点判断

**结论**

- 只读 3 个项目：`Spotube`、`YesPlayMusic`、`MusicFree`
- 桌面端架构优先看：`YesPlayMusic`、`Nuclear`
- 插件化音源架构优先看：`MusicFree`、`Spotube`
- Android 本地库优先看：`Auxio`
- 交互历史参考可看：`ViMusic`，但不建议作为现役基线

**核心样本**

| 项目                                                            |  Stars | 最新发布 / 活跃度                                           | 技术栈 / 平台                                 | 最值得参考                                              | 风险 / 备注                                  |
| --------------------------------------------------------------- | -----: | ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| [KRTirtho/spotube](https://github.com/KRTirtho/spotube)         | 47,171 | `v5.1.2`，2026-06-05；最近代码推送 2026-06-05               | Flutter；桌面 + 移动                          | 插件驱动的音源抽象、跨端统一播放器、歌词与下载能力分层  | 许可证元数据未明确，直接复用代码前需人工复核 |
| [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic) | 32,982 | 最新 release `v0.4.10`，2025-10-09；最近代码推送 2026-06-14 | Vue + Electron + PWA；桌面 + Web              | Web 技术栈复用到桌面播放器、播放器壳层与页面共用一套 UI | 假设偏向网易云生态，业务模型不能原样照搬     |
| [maotoumao/MusicFree](https://github.com/maotoumao/musicfree)   | 25,376 | 最新 release `v0.6.2`，2025-10-11；最近代码推送 2026-06-20  | React Native + TypeScript；Android / Harmony  | 播放器内核与音源插件解耦、主题与定制能力、插件协议设计  | `AGPL-3.0`，直接复用代码有传染性义务         |
| [nukeop/nuclear](https://github.com/nukeop/nuclear)             | 17,909 | `player@1.41.0`，2026-06-21；最近代码推送 2026-06-27        | Tauri + React + Rust；桌面                    | 桌面端模块化、插件商店思路、Rust + Web UI 混合边界      | 架构偏重，不适合拿来做最小化起步样板         |
| [OxygenCobalt/Auxio](https://github.com/OxygenCobalt/Auxio)     |  3,956 | `v4.1.0`，2026-06-15；最近代码推送 2026-06-24               | Kotlin + Media3/ExoPlayer；Android 本地播放器 | 纯本地媒体库、标签解析、Android 播放器结构干净          | 不覆盖插件化音源与跨端场景                   |
| [Taiko2k/Tauon](https://github.com/Taiko2k/Tauon)               |  2,706 | `v10.0.1`，2026-05-29；最近代码推送 2026-06-26              | 桌面本地库播放器；Linux / Windows             | 本地媒体库 UX、媒体服务器整合、收藏管理                 | 更适合本地音乐库方向，不是流媒体插件架构样板 |

**补充与历史参考**

| 项目                                                                | Stars | 状态                                                        | 适合参考                                   | 备注                                   |
| ------------------------------------------------------------------- | ----: | ----------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| [vfsfitvnm/ViMusic](https://github.com/vfsfitvnm/ViMusic)           | 9,452 | 已归档；最后代码推送 2024-07-15                             | Android 音乐播放器交互、移动端视觉语言     | 只适合看交互，不适合做当前技术基线     |
| [harmonoid/harmonoid](https://github.com/harmonoid/harmonoid)       | 4,609 | 最新 release `v0.3.22`，2026-01-28；最近代码推送 2026-06-27 | 跨端本地库、歌词、标签、桌面与移动统一体验 | 许可证元数据未明确，复用前需单独核验   |
| [anandnet/Harmony-Music](https://github.com/anandnet/Harmony-Music) | 3,042 | 最新 release `v1.12.2`，2025-12-07；最近代码推送 2025-12-08 | Flutter 跨端流媒体壳层                     | 可作补充样本，但维护节奏不如前几项稳定 |

**按场景推荐**

- 做 `Web/Electron` 播放器：
  - 先看 `YesPlayMusic`
  - 再看 `Nuclear`
  - 重点观察播放器壳层、队列面板、桌面打包与 Web 复用边界
- 做插件化音源架构：
  - 先看 `MusicFree`
  - 再看 `Spotube`
  - 重点观察插件协议、音源能力声明、播放器内核与来源层的解耦
- 做单代码库跨端播放器：
  - 先看 `Spotube`
  - 再看 `harmonoid`
  - 重点观察桌面与移动端如何共享播放域模型
- 做 Android 本地媒体库：
  - 先看 `Auxio`
  - 再看 `ViMusic`
  - 前者看结构，后者看交互

**值得直接吸收的架构做法**

- `Adapter Pattern` + `Strategy Pattern`：
  - 每个音源只暴露统一能力接口，例如 `search`、`playlist`、`stream`、`lyrics`、`download`
  - UI 不应该写一堆 `if source === xxx`
- 能力声明而不是硬编码：
  - 用 capability flags 描述“可搜索、可播、可下载、可显示歌词”
  - 页面根据能力动态渲染，而不是把某个平台的行为写死在组件里
- 播放核心与音源层解耦：
  - 队列项、播放状态、歌词状态应使用标准化领域模型
  - 不要把某个平台的字段直接塞进全局 player store
- 上游故障降级：
  - 建议使用 `circuit breaker`、短 TTL 健康缓存、自动 fallback
  - 这是比“环境变量存在就显示来源”更稳的主流方案
- 壳层与内核分离：
  - mini player、fullscreen player、queue、lyrics 只消费稳定播放器状态
  - 不让音源插件直接操作 UI 组件内部状态

**明确不建议照搬的点**

- 不建议把第三方平台的业务字段直接做成全局播放模型
- 不建议在页面组件里直连各个音源 SDK 或 HTTP 细节
- 不建议继续显示“已配置但已失效”的来源入口
- 不建议直接复制 `AGPL` / `GPL` 项目代码而不先确认许可证影响

**对 LunaTV 的直接建议**

- 如果 LunaTV 继续走 Web 优先路线，第一参考对象应该是 `YesPlayMusic`
- 如果 LunaTV 后续要支持多音源和降级，第一参考对象应该是 `MusicFree` 与 `Spotube`
- 如果 LunaTV 未来要做桌面客户端，`Nuclear` 比单纯 Electron 样本更值得看模块边界
- 如果只需要把当前播放器体验做稳、做清晰，先吸收 `YesPlayMusic` 的壳层组织，再借鉴 `ViMusic` 的移动端交互即可
