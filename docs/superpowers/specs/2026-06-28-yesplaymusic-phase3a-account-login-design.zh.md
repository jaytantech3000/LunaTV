# LunaTV 音乐系统从零复刻 Phase 3a 账号接入设计

**目标**

在已完成 Phase 1 壳层重建和 Phase 2 `Netease` 真实数据纵切的基础上，补齐账号能力的第一条正式登录链路：以 `YesPlayMusic` 的二维码登录为参考，在当前 `React + Next.js + Tauri` 栈内重建桌面优先的网易云账号接入体验，并替换当前手填 `MUSIC_U` / 完整 cookie 的临时入口。

**完整目标中的位置**

完整复刻仍然是 5 个子项目：

1. 应用壳层
2. 播放核心
3. 数据域
4. 账号能力
5. 桌面集成

Phase 1 已完成子项目 1 + 2。  
Phase 2 已完成子项目 3 的第一条 `Netease` 纵切。  
本设计文档覆盖 **Phase 3a = 子项目 4 的第一条正式登录链路**：先补齐二维码登录主通路，并把手填 cookie 降级为高级兜底入口。

**为什么先做二维码登录**

推荐先做“二维码登录主通路”，而不是一次性补齐手机号、邮箱和 cookie 三套入口：

1. 当前 `src/features/music/` 已经具备新的账号 store、账号 route 和 session 持久化链路，缺的是更接近正式产品的登录入口，而不是账号数据骨架
2. 当前桌面版账号入口仍要求手填 `MUSIC_U` / 完整 cookie，明显不符合“从零复刻”的产品完成度
3. `YesPlayMusic` 的默认登录体验就是二维码模式，先补这条路径最接近用户可感知的主入口
4. 二维码成功后仍然可以复用现有 session cookie 写入和账号刷新链路，风险明显低于同时引入密码登录
5. 手机号 / 邮箱登录会额外引入密码输入、加密、风控失败和更多错误态，本切片不需要先承担这些复杂度

**范围**

- 默认登录入口改成 `二维码登录`
- 保留手填 `cookie`，但降级为 `高级接入 / fallback`，不再作为主入口
- 新增二维码创建、二维码状态轮询和登录成功写入 session 的完整链路
- 登录成功后刷新：
  - 我的歌单
  - 每日推荐
  - 私人 FM
  - 设置中的账号状态
- 断开账号后，所有依赖登录态的入口立即回退到未登录态
- 保持桌面模式优先，不为兼容旧 Web-only 预览而改变主交互语义

**不做**

- 本切片不补手机号登录
- 不补邮箱登录
- 不补收藏同步、播放历史同步、喜欢列表写回等更深账号能力
- 不改动现有 `MusicAccountEntity` 的核心语义
- 不重写当前 session cookie 的存储格式
- 不为了追求一步到位而并行新增多种登录面板

**现状结论**

当前分支已经具备 3 个可复用基础：

1. [音乐账号 route](/Users/jay/Code/LunaTV/src/app/api/music/account/route.ts)
   - 已支持读取当前账号态
   - 已支持写入手填 cookie
   - 已支持断开会话
2. [session 持久化](/Users/jay/Code/LunaTV/src/features/music/services/music-account-session.ts)
   - 已有标准化 cookie 过滤
   - 已有服务端 session cookie 读写和清理
3. [账号 store 与 UI](/Users/jay/Code/LunaTV/src/features/music/state/music-account-store.ts)
   - 已有 hydrate / connect / disconnect 基本动作
   - 但 [MusicAccountCard](/Users/jay/Code/LunaTV/src/features/music/components/MusicAccountCard.tsx) 仍停在手填 cookie 模式

结论：

- 当前账号系统不是“没有基础”，而是“主入口仍然是临时方案”
- Phase 3a 应该复用现有 route、store、session 骨架，只替换登录主通路

**核心方案**

1. 保留现有 `/api/music/account` 作为账号态、cookie fallback 和断开会话入口
2. 新增独立的二维码登录 route，承载：
   - 二维码创建
   - 扫码状态轮询
   - 登录成功后写入现有 session cookie
3. 在 `services/providers/netease/` 下扩展二维码登录 provider 能力，不允许把网易原始扫码 payload 泄漏到组件层
4. 在 `MusicAccountCard` 内将二维码登录升级为未登录态默认入口，手填 cookie 变成次级入口
5. 登录成功后统一走“写 session -> hydrate account -> refresh home/bootstrap”的现有刷新链路
6. 断开会话后统一回退到未登录态，不保留失效 UI 分支

**新的路由边界**

保留现有：

- `GET /api/music/account?source=netease`
- `POST /api/music/account?source=netease`
- `DELETE /api/music/account?source=netease`

新增：

- `POST /api/music/account/qr?source=netease`
  - 创建二维码登录会话
  - 返回：
    - `key`
    - `qrUrl`
    - `qrImageDataUrl`
    - `status`
- `GET /api/music/account/qr?source=netease&key=<unikey>`
  - 轮询二维码状态
  - 统一返回：
    - `status = waiting | scanned | expired | confirmed`
    - `account`（仅 confirmed 时存在）
    - `playlists`（仅 confirmed 时存在）

关键约束：

- `confirmed` 时由服务端直接写入现有 `lunatv_music_netease_session`
- 前端不直接接触可复用的登录 cookie
- 统一错误结构继续返回 `{ error: string }`
- 二维码 route 只能调用新的 `services/providers/netease/*` 能力，不允许绕回旧音乐目录

**新的 provider 能力**

在 `src/features/music/services/providers/netease/` 下扩展：

- `createQrLoginKey(): Promise<{ key: string }>`
- `createQrLoginCode(key: string): Promise<{ key: string; qrUrl: string; qrImageDataUrl: string }>`
- `checkQrLoginStatus(key: string): Promise<QrLoginStatusResult>`

建议新的统一结果模型：

- `waiting`
  - 等待扫码
- `scanned`
  - 已扫码，待手机确认
- `expired`
  - 二维码失效
- `confirmed`
  - 登录成功
  - 包含标准化后的 session cookie
  - 包含标准化后的账号实体

显式约束：

- provider 层负责把网易 `800 / 801 / 802 / 803` 映射到统一状态
- route 和组件层不直接处理网易原始状态码
- 如果上游返回 cookie，仍先走现有 `normalizeNeteaseSessionCookie` 再写入 session

**前端状态与数据流**

保留现有 `music-account-store` 的账号主状态，并新增二维码登录的临时 UI 状态：

- `qrState`
  - `status: 'idle' | 'loading' | 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'error'`
  - `key`
  - `qrUrl`
  - `qrImageDataUrl`
  - `message`
- `startQrLogin()`
  - 创建二维码并进入等待态
- `pollQrLogin()`
  - 拉取扫码状态
- `stopQrLoginPolling()`
  - 停止轮询
- `retryQrLogin()`
  - 二维码失效后重新生成

客户端主流程：

1. `MusicAccountCard` 发现当前未登录
2. 默认调用 `startQrLogin()`
3. 渲染二维码卡片
4. 定时轮询 `pollQrLogin()`
5. 如果状态是：
   - `waiting`：显示等待扫码
   - `scanned`：显示“已扫码，请在手机确认”
   - `expired`：停止轮询，显示重新生成
   - `confirmed`：停止轮询，hydrate 当前账号并刷新首页
6. 登录成功后：
   - sidebar 立即出现我的歌单
   - 首页立即出现每日推荐 / 私人 FM
   - 设置页账号状态同步变为已连接

**UI 与交互**

未登录态：

- 默认展示二维码登录卡片
- 标题显示 `Netease account`
- 主区域显示二维码图片
- 状态文案只保留 4 种正式语义：
  - `等待扫码`
  - `已扫码，请在手机确认`
  - `二维码已失效，请重新生成`
  - `登录成功，正在同步`
- 二维码区域下方提供：
  - `重新生成`
  - `改用 cookie 接入`

cookie fallback：

- 不再占据主入口区域
- 只在用户主动切换时展开输入框
- 仍复用现有 `connectSession(cookie)` 行为

已登录态：

- 展示网易账号昵称、签名和歌单数量
- 展示 `Disconnect` 按钮
- 不再展示二维码轮询区域

断开态：

- 调用现有 `disconnectSession()`
- 清理二维码轮询
- 立即切回二维码主入口

**错误处理**

- 二维码创建失败：
  - 显示错误提示
  - 显示 `重新生成`
  - 保留 `改用 cookie 接入`
- 二维码失效：
  - 停止轮询
  - 状态切为 `expired`
  - 允许一键重新生成
- 轮询网络失败：
  - 不立即清空二维码
  - 显示非阻断错误
  - 允许下次轮询恢复
- 登录成功但 hydrate 账号失败：
  - 保留已写入的 session
  - 前端走一次显式 `hydrateAccount()`
  - 必要时展示“同步账号状态失败，请稍后重试”
- 组件卸载、折叠或切换入口时：
  - 必须清理定时器，禁止重复轮询

**测试要求**

route 测试：

- 创建二维码成功
- 轮询 `waiting`
- 轮询 `scanned`
- 轮询 `expired`
- 轮询 `confirmed` 时写入现有 session cookie

store 测试：

- 未登录时启动二维码登录
- 登录成功后停止轮询
- 二维码失效后可重新生成
- 组件卸载或断开会话时清理轮询

UI 测试：

- 未登录默认展示二维码
- 扫码成功后切换到已登录账号卡片
- 登录成功后首页出现每日推荐 / 私人 FM
- 切到 cookie fallback 后仍可复用原有连接行为

回归要求：

- 现有 cookie fallback 测试必须保留并继续通过
- 现有我的歌单 / 每日推荐 / 私人 FM 行为不得回归

**验收标准**

以下条件同时满足，才算 Phase 3a 完成：

1. 未登录用户进入 `/music` 时，默认看到二维码登录，而不是手填 `MUSIC_U`
2. 二维码扫码状态能正确经历 waiting / scanned / expired / confirmed 四种 UI 反馈
3. 登录成功后，服务端写入现有 session cookie，前端无需持久化原始登录 cookie
4. 登录成功后，我的歌单、每日推荐、私人 FM 和设置账号态立即刷新
5. 断开账号后，所有依赖登录态的入口立即回退，二维码主入口重新出现
6. 手填 cookie fallback 仍可用，但已降级为次级入口
7. route / store / UI 回归测试通过

**后续阶段**

Phase 3a 完成后，账号能力仍有 3 条后续工作：

1. `Phase 3b`
   - 手机号 / 邮箱登录
2. `Phase 3c`
   - 收藏、播放历史、喜欢列表等更深账号能力
3. `Phase 4`
   - 继续补齐桌面托盘、缓存、下载和本地桌面集成
