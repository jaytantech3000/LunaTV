# LunaTV Feature Log

本文件用于记录本项目“新功能”的开发轨迹，避免把阶段性实现细节、回归记录和后续待办堆进 `Agent.md`。

## 使用约定

- 新纪录按时间倒序追加，最新的放在最上面。
- 只记录“功能级”变更，不记录琐碎的重命名、格式化或纯注释修改。
- 每条记录尽量包含：目标、核心改动、验证结果、后续待办。
- 若功能有详细方案文档，优先链接到 `dev-plan/` 下的对应文件。

---

## 2026-06-17 - 下载面板动作布局与原生卸载入口 v1

- 分支：`nova`
- 方案/说明文档：
  - `docs/local-service-release.md`

### 目标

- 整理客户端下载面板里本地服务按钮布局，避免不同平台动作数量不一致时出现错位和凌乱。
- 把卸载入口尽量改成安装后就地可执行或系统可识别的原生方式，而不是继续把“下载卸载脚本”暴露成默认路径。

### 核心实现

- 下载面板本地服务区域改成固定动作列布局：
  - `src/components/DownloadClientPanel.tsx`
- “下载卸载脚本”改成“查看卸载方式”，并保留兜底卸载脚本：
  - `src/components/DownloadClientPanel.tsx`
- macOS 安装包内新增卸载入口：
  - `.github/local-service/macos/uninstall-local-service.command`
  - `.github/local-service/macos/uninstall-local-service.sh`
- Windows 安装包内新增卸载入口与系统卸载注册：
  - `.github/local-service/windows/install-local-service.cmd`
  - `.github/local-service/windows/uninstall-local-service.cmd`
  - `.github/workflows/local-service-release.yml`
- 卸载脚本接口同步改成更贴近原生卸载路径：
  - `src/app/api/local-service-script/route.ts`

### 本阶段已处理的问题

- Linux 两按钮、其他平台一按钮时，下载行高和按钮对齐不一致，视觉上比较散。
- 管理卡片里“下载卸载脚本”与安装包化方向不一致，用户看不到优先应走的系统卸载入口。
- Windows 安装包此前不会在“已安装的应用”里注册卸载项；macOS 安装包也缺少安装后可直接找到的卸载器。

## 2026-06-17 - 本地服务 Linux `.deb` 安装包与脚本兜底 v1

- 分支：`nova`
- 方案/说明文档：
  - `docs/local-service-release.md`

### 目标

- 为 Linux 端本地服务尽量提供安装包，而不是只给脚本。
- 保持 Debian / Ubuntu 用户可直接安装，同时不牺牲其他 Linux 发行版的脚本兜底路径。
- 让 Linux 停止 / 卸载脚本同时兼容 `.deb` 安装和旧版 `~/.lunatv` 脚本安装。

### 核心实现

- 新增 Linux 发布资源与 systemd 服务定义：
  - `.github/local-service/linux/lunatv-local-service.service`
  - `.github/local-service/linux/postinst`
  - `.github/local-service/linux/prerm`
  - `.github/local-service/linux/postrm`
- Linux 本地服务 release 现在额外产出：
  - `lunatv-local-service-linux-x64.deb`
  - `lunatv-local-service-linux-arm64.deb`
- Web 下载映射与面板升级：
  - `src/lib/client-download.ts`
  - `src/app/api/client-download/route.ts`
  - `src/components/DownloadClientPanel.tsx`
- Linux 停止 / 卸载脚本兼容 systemd + `dpkg` 安装场景：
  - `src/app/api/local-service-script/route.ts`

### 本阶段已处理的问题

- Linux 端此前只能下载脚本，Debian / Ubuntu 用户缺少可安装包。
- 如果直接把 Linux 平台切成安装包入口，Fedora / Arch 等非 `.deb` 发行版会失去原有脚本安装路径。
- Linux 停止 / 卸载脚本此前只认 `~/.lunatv` 用户目录，不识别 systemd 和系统级安装目录。

### 当前约束

- 当前 Linux 安装包先覆盖 Debian / Ubuntu `.deb` 生态，其他发行版仍建议使用脚本安装。
- `.deb` 安装链路的最终双击体验仍需要在真实 Linux 桌面环境做一次人工回归。

## 2026-06-17 - 本地服务 Windows 安装包与发布可用性修复 v1

- 分支：`nova`
- 方案/说明文档：
  - `docs/local-service-release.md`

### 目标

- 为 Web 端本地服务补齐 Windows 双击安装包，减少脚本安装失败率。
- 修复 `luna` / `nova` 等分支通道在 release 缺失时，下载面板仍错误暴露可下载入口的问题。
- 让脚本安装链路和安装包链路都使用统一的配置文件与启动参数，避免本地服务启动后找不到配置或数据目录。

### 核心实现

- Windows 本地服务安装器与发布工作流升级：
  - `.github/workflows/local-service-release.yml`
  - `.github/local-service/windows/install-local-service.cmd`
  - `.github/local-service/windows/run-local-service.vbs`
- Web 下载可用性判断和安装器映射修复：
  - `src/lib/client-download.ts`
  - `src/app/api/client-download/route.ts`
  - `src/components/DownloadClientPanel.tsx`
- 安装 / 停止 / 卸载脚本统一配置与数据目录：
  - `src/app/api/local-service-script/route.ts`
- 补齐针对性自动化测试与文档：
  - `src/lib/client-download.test.ts`
  - `src/app/api/client-download/route.test.ts`
  - `src/app/api/local-service-release/route.test.ts`
  - `src/app/api/local-service-script/route.test.ts`
  - `src/components/DownloadClientPanel.test.tsx`
  - `README.md`
  - `docs/local-service-release.md`

### 本阶段已处理的问题

- Windows 端此前只有原始服务 exe 或脚本，缺少真正可双击执行的安装包。
- `local-service-<channel>-latest` 在 GitHub 上不存在真实 release 时，下载面板仍会按理论 URL 显示脚本入口，用户点进去只能得到失效链接。
- Windows / Unix 脚本安装链路没有传 `--config-path`、`--data-dir`、`--sqlite-path`，本地服务启动后容易落到错误工作目录。
- Windows 安装与卸载没有统一处理 `%LOCALAPPDATA%` 安装目录、自启动项和旧版 `~/.lunatv` 遗留文件。

### 验证结论

- `pnpm test -- src/lib/client-download.test.ts src/app/api/local-service-release/route.test.ts src/app/api/client-download/route.test.ts src/app/api/local-service-script/route.test.ts src/components/DownloadClientPanel.test.tsx` 已通过。
- `pnpm lint` 已通过。
- `pnpm typecheck` 已通过。
- `pnpm build` 已通过。
- `cargo test --manifest-path crates/moontv-local-service/Cargo.toml --locked` 已通过。

### 当前约束

- Windows 自解压安装器的真实打包结果仍依赖 GitHub Actions 的 Windows runner 产物验证。
- 双击安装和卸载的最终体验仍需要在真实 macOS / Windows 机器上做一次人工回归。

### 后续建议

- 为 GitHub Release 产物补一份人工回归清单，至少覆盖 macOS `.pkg`、Windows `.exe`、Linux 脚本三条安装链路。
- 若后续继续扩展更多本地服务安装形态，优先保持 `client-download` 与 `local-service-release` 的资产命名约定不变。

## 2026-06-16 - Web 版本信息面板双语化与版本检查增强 v1

- 分支：`nova`
- 方案来源：
  - `desktop` 分支已有的双语版本面板与 semver 版本比较能力

### 目标

- 将桌面端已验证的版本信息展示体验中适合 Web 的部分同步到网页端。
- 让版本面板支持中英文切换，并可分别读取对应语言的远程变更日志。
- 把版本检查从字符串比较升级为 semver 比较，避免预发布版本和多位数字版本判断错误。
- 将仓库地址、远程 changelog 分支和版本号文件分支改为可配置，方便 `nova` / `luna` 等环境复用。

### 核心实现

- 新增版本地址配置工具：
  - `src/lib/release-urls.ts`
- 新增 semver 解析与比较：
  - `src/lib/semver.ts`
  - `src/lib/version_check.ts`
- 版本面板升级为双语和远程状态卡片：
  - `src/components/VersionPanel.tsx`
  - `src/app/login/LoginPageClient.tsx`
- 新增英文 changelog，并将本地 changelog 生成链路改为双语：
  - `CHANGELOG.en`
  - `scripts/convert-changelog.js`
  - `src/lib/changelog.ts`
- 补齐针对性自动化测试：
  - `src/components/VersionPanel.test.tsx`
  - `src/lib/semver.test.ts`
  - `src/lib/release-urls.test.ts`
  - `src/lib/version_check.test.ts`

### 本阶段已处理的问题

- Web 端版本面板只能展示单语言内容，无法跟随用户需要切换中英文 changelog。
- 版本面板和登录页中的仓库地址、远程 changelog 分支写死，不利于 `nova` / `luna` 环境切换。
- 版本检查依赖简单字符串比较，对 `100.1.10`、`beta` / `prerelease` 版本的判断不可靠。
- 本地 changelog 只有中文版本，无法在前端直接复用双语内容。

### 验证结论

- `node scripts/convert-changelog.js` 已通过。
- `pnpm test -- src/lib/semver.test.ts src/lib/release-urls.test.ts src/lib/version_check.test.ts src/components/VersionPanel.test.tsx src/app/login/page.test.tsx src/components/UserMenu.test.tsx` 已通过。
- `pnpm lint` 已通过。
- `pnpm typecheck` 已通过。
- `pnpm build` 已通过。

### 当前约束

- 本次只同步适合 Web 的版本展示与版本检查能力，不包含桌面端安装器、内置更新器或本地密码持久化逻辑。
- `CHANGELOG.en` 目前只覆盖 Web 版本线，未纳入桌面端 `200.x` 发布记录。

### 后续建议

- 若后续继续维护多分支发布，保持 `CHANGELOG` / `CHANGELOG.en` 版本号和日期一一对应，避免生成链路回退到中文内容。
- 若未来需要把 release 目标从 GitHub 扩展到其他分发源，优先继续沿用 `src/lib/release-urls.ts` 这一层统一收口。

## 2026-06-16 - 客户端下载、本地服务加速与播放器增强 v1

- 分支：`nova`
- 里程碑提交：`d6033ef`
- 方案/说明文档：
  - `dev-plan/2026-06-15-client-download-panel.md`
  - `docs/local-service-release.md`

### 目标

- 在 Web 端提供统一的客户端下载入口，按平台下发桌面客户端和本地服务。
- 打通本地服务的发布、安装、启停、卸载和页面内启用/恢复默认线路闭环。
- 把播放器增强设置收敛为更易理解的本地设置，并补齐 HLS 缓冲优化与倍速风险提示。
- 优化登录和进入管理面板时的过渡反馈，降低“无响应”感。

### 核心实现

- 新增客户端下载与发布解析链路：
  - `src/components/DownloadClientPanel.tsx`
  - `src/app/api/client-download/route.ts`
  - `src/app/api/desktop-release/route.ts`
  - `src/app/api/local-service-release/route.ts`
  - `src/lib/client-download.ts`
- 新增本地服务运行时与发布基础设施：
  - `crates/moontv-local-service/*`
  - `.github/workflows/local-service-release.yml`
  - `src/app/api/local-service-script/route.ts`
  - `src/lib/local-service-runtime.ts`
- 新增本地服务状态入口与启停反馈：
  - `src/components/LocalServiceStatusBanner.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/PageLayout.tsx`
- 播放器增强设置与播放页联动重做：
  - `src/lib/player-enhancements.ts`
  - `src/lib/hls-playback-config.ts`
  - `src/app/play/page.tsx`
  - `src/components/UserMenu.tsx`
- 登录和后台导航反馈优化：
  - `src/app/login/*`
  - `src/app/admin/*`
  - `src/components/NavigationFeedbackProvider.tsx`

### 本阶段已处理的问题

- 用户菜单缺少统一的客户端下载入口，桌面版和本地服务下载链路分散。
- 本地服务 release tag、仓库地址和分支通道需要手工配置，部署到 `nova` / `luna` 时容易错线。
- HTTPS 页面访问本机 `127.0.0.1` 健康检查时缺少兼容处理，本地服务状态容易误判。
- 本地服务启用后缺少“停用 / 检测 / 最小化 / 恢复默认”的完整反馈。
- 播放增强设置分散，缓冲模式与倍速插件干预提示不够直观。
- 登录提交和进入管理面板时缺少明确的过渡态。

### 验证结论

- `pnpm lint` 已通过。
- `pnpm typecheck` 已通过。
- `pnpm test` 已通过（46 / 46 suites，206 / 206 tests）。
- `pnpm build` 已通过。
- `cargo test --manifest-path crates/moontv-local-service/Cargo.toml` 已通过。
- 关键自动化覆盖已补到：
  - 下载面板 release 加载、缺失目标禁用与重试逻辑。
  - 本地服务状态检测、启用、停用、恢复、最小化 / 展开。
  - 本地服务 release 元数据和安装 / 停止 / 卸载脚本接口。
  - 播放器增强偏好读取、缓冲模式切换和 HLS 参数映射。

### 当前约束

- 本地服务当前只对 macOS 提供原生 `.pkg` 安装包；Windows / Linux 仍以脚本安装、停止和卸载为主。
- 页面侧“启用本机加速”只覆盖媒体代理地址，不会把整站 API 都切到本地服务。
- 本地服务安装、启动和卸载的真实系统行为仍需要在目标平台手工验证。

### 后续建议

- 增加跨平台安装 / 停止 / 卸载和 HTTPS 私网探测的 E2E 或人工回归清单。
- 继续拆分 `src/app/play/page.tsx`，把播放器会话恢复、设置面板和 HLS 初始化逻辑解耦。
- 若后续要引入更多客户端形态，保持 `client-download` 与 `local-service-release` 的 tag / asset 约定不变。

## 2026-06-04 - 离线下载与离线播放 v1

- 分支：`cache-and-download`
- 里程碑提交：`a95a673`
- 方案文档：
  - `dev-plan/cache-and-download/plan-d-recommended-offline-download.md`
  - `dev-plan/cache-and-download/plan-d-implementation-checklist.md`

### 目标

- 提供剧集离线下载能力。
- 在 `/downloads` 页面集中管理下载任务和已下载内容。
- 支持从已下载内容直接进入离线播放。
- 在断网场景下尽可能维持已缓存内容可播放。

### 核心实现

- 新增 VOD same-origin 代理链路：
  - `src/app/api/proxy/vod/m3u8/route.ts`
  - `src/app/api/proxy/vod/segment/route.ts`
  - `src/app/api/proxy/vod/key/route.ts`
- 新增离线下载核心模块：
  - `src/lib/download/*`
  - `src/stores/downloadStore.ts`
  - `worker/index.ts`
- 新增下载相关页面与组件：
  - `src/app/downloads/page.tsx`
  - `src/components/CurrentEpisodeDownloadControl.tsx`
  - `src/components/DownloadsClient.tsx`
  - `src/components/DownloadSessionSync.tsx`
- 播放页接入在线/离线双模式：
  - `src/app/play/page.tsx`
  - 离线模式支持缓存读取、播放进度恢复、选集切换、缺失资源校验。
- 本地生产预览链路补齐：
  - `scripts/start-standalone-preview.sh`
  - `package.json` 中新增 `pnpm preview:offline`

### 本阶段已处理的问题

- 下载过程中任务顺序和状态显示异常。
- 批量下载交互重做为弹窗选集模式，支持全选、单选、反选、从当前集开始选。
- 下载失败后“重试/取消”状态不一致的问题。
- 离线播放切断网络后无法继续播放的问题。
- 离线模式切换选集会丢失播放进度的问题。
- 下载页存在活动下载任务时，从 `/downloads` 点击“离线播放”无响应/不稳定的问题。

### 验证结论

- `pnpm build` 已通过。
- 本地离线链路需使用 `pnpm preview:offline` 验证，不能只看 `pnpm dev`。
- 已做过的关键回归：
  - 在线播放正常起播。
  - 单集下载后可从 `/downloads` 进入离线播放。
  - 同页在线播放切换到离线播放可正常重建播放器。
  - 离线播放开始后切断网络，播放时间仍能继续推进。
  - 有活动下载任务时，从 `/downloads` 点击已下载条目的“离线播放”可进入播放页并起播。

### 当前约束

- Web 版离线资源仍基于浏览器缓存，不支持选择系统目录或直接打开系统文件夹。
- 离线能力依赖浏览器支持 Cache Storage、IndexedDB、Service Worker。
- `next dev` 默认不是完整离线验证环境。

### 后续建议

- 把下载目录设置、桌面端文件系统接入放到独立能力设计中，不要与当前浏览器缓存方案混用。
- 对下载任务恢复、失败分类、资源清理策略补更多自动化测试。
- 若后续加入 Background Fetch，应保持现有缓存结构和播放入口不变，在 v1 架构上增强。
