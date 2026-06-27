# LunaTV 音乐播放器与 Jamendo 降级设计

**目标**

修复音乐页歌单卡片播放行为，屏蔽 Jamendo suspended application 异常对用户的直接暴露，并把当前播放器重构为贴近网易云音乐参考图的底部控制条与展开态播放器。

**范围**

- 点击歌单卡片右上角播放 icon 时，直接拉取该歌单详情并整组播放
- 点击歌单卡片主体时，仍然进入歌单详情页，不改变原有浏览路径
- Jamendo 上游返回 suspended application 错误时，来源自动降级，不再把英文原始报错直接显示到页面
- 重构底部 mini player，使布局、控件分区、视觉层级贴近参考图
- 重构 expanded player，使其与底部控制条使用同一套视觉语言与控件语义
- 为歌单直接播放、Jamendo 降级、播放器交互补齐自动化测试

**不做**

- 不重写 `musicPlayerStore`
- 不替换 `MusicPlayerRoot` 内现有 `audio` 播放链路
- 不新增新的音乐来源或新的播放模式
- 不接入 Jamendo 私有修复方案或后台人工恢复逻辑

**现状结论**

- `MusicCollectionGrid` 里的播放 icon 与卡片主体共用同一条 `onSelect` 链路，所以现在只能进入歌单详情，不能直接播放
- Jamendo 当前是否显示仅由 `JAMENDO_CLIENT_ID` 是否存在决定，没有把“已配置但上游已被 suspend”视为不可用状态
- 当前播放器是自定义暗色浮层，结构上更像大卡片，不是参考图中的网易云底部控制条

**核心方案**

1. 保留现有播放内核，只替换触发链和视图层
2. 在 Jamendo provider 层做可用性降级，而不是在前端页面里猜错误字符串
3. 让 mini player 与 expanded player 共享同一套视觉和交互语义，避免两套播放器风格打架

**组件边界**

- `src/components/music/MusicCollectionGrid.tsx`
  - 拆分“进入歌单详情”和“直接播放歌单”两条事件链
  - 卡片主体保留 `onSelect`
  - 播放 icon 改为单独的 `onPlayCollection`
- `src/components/music/MusicPageClient.tsx`
  - 新增“按歌单摘要直接播放”的异步链路
  - 当来源已失效时，自动切回首个可用来源
  - 只负责页面级调度，不承载底层播放状态
- `src/lib/music/jamendo.ts`
  - 统一识别 suspended application 响应
  - 返回稳定的业务错误语义，而不是原始英文报错
- `src/lib/music/service.ts`
  - 负责聚合来源可用性和 Jamendo 降级结果
- `src/components/music/MusicMiniPlayer.tsx`
  - 改造成参考图中的底部横向控制条
- `src/components/music/MusicFullscreenPlayer.tsx`
  - 改造成与底部控制条同风格的展开态播放器
- `src/components/music/MusicQueuePanel.tsx`
  - 保留队列能力，样式服从新的播放器壳层
- `src/components/music/MusicLyricsPanel.tsx`
  - 保留歌词滚动能力，样式服从新的播放器壳层

**歌单直接播放链路**

- 歌单卡片主体点击：
  - 更新 URL
  - 进入歌单详情
- 歌单播放 icon 点击：
  - 阻止事件冒泡，避免误触发详情跳转
  - 通过 `fetchMusicCollection({ source, id })` 拉取完整歌单
  - 过滤 `playable === true` 的曲目
  - 调用 `playQueue(playableTracks.map(buildQueueItemFromTrack), 0)`
  - 如果歌单为空或全不可播，则保持当前页面不跳转，并展示非阻断提示

**Jamendo 降级策略**

- 服务端在 `src/lib/music/jamendo.ts` 识别以下上游异常语义：
  - `Your application has been suspended`
  - `Suspended Application Error`
- 一旦命中该类异常：
  - 统一抛出稳定错误，例如“Jamendo 官方接口当前不可用”
  - 状态码保留 `503`
- 来源可用性不再只看 `JAMENDO_CLIENT_ID`：
  - `configured`：环境变量存在
  - `healthy`：最近一次探测未命中 suspended
  - 只有 `configured && healthy` 时才显示为 enabled
- 增加轻量短 TTL 熔断缓存：
  - 首次命中 suspended 后，短时间内直接视为 disabled
  - 避免用户连续刷新仍反复撞上游错误
- 客户端回退：
  - 如果当前 URL 为 `source=jamendo`
  - 且 sources API 已返回 Jamendo disabled
  - 则自动切回第一个 enabled 的来源
  - 页面展示明确但非阻断的说明文案，不再显示整块红色英文异常

**播放器还原方案**

**Mini Player**

- 外层容器改为大圆角胶囊条
- 背景改为深色蓝绿渐变
- 左侧：
  - 封面
  - 歌名
  - 歌手
  - 当前歌词一句或副标题
- 中部：
  - 主进度条
  - 当前时间 / 总时长
- 下部或左下：
  - 音量按钮
  - 音量滑杆
  - 音量数值
- 右侧：
  - 上一首
  - 播放 / 暂停
  - 下一首
  - 停止
  - 关闭
- 顶部独立保留“展开播放器”按钮

**Expanded Player**

- 保留同一套底色、圆角、描边和按钮语义
- 左区作为主视觉：
  - 放大封面
  - 曲目信息
  - 进度条
  - 主控制按钮
  - 音量控制
  - 收藏与播放模式
- 右区作为辅助区：
  - 歌词
  - 队列
- `歌词 / 队列` 仍可切换，但不再渲染成与主播放器割裂的独立大卡片

**视觉约束**

- 白色主播放按钮
- 其他控制按钮使用细描边圆形按钮
- 进度条与音量条使用细轨道和白色圆形 thumb
- 文字层级优先保证歌名、歌手、时长和主要操作可读
- 移动端保留同一视觉语言，但布局允许折叠为两行或三行，避免硬塞桌面结构

**错误处理与边界**

- 歌单详情加载失败：
  - 不修改当前队列
  - 给出明确错误提示
- 歌单无可播曲目：
  - 不开始播放
  - 不跳转详情
  - 给出“当前歌单暂无可播放曲目”
- Jamendo 失效时：
  - 失效平台不再可点击进入
  - 当前页若已在 Jamendo，则自动切换来源
- 队列为空时：
  - mini player 保持隐藏
  - expanded player 不应强制展开
- 无歌词或无封面时：
  - 使用现有占位能力
  - 不让布局塌陷

**测试方案**

- `src/components/music/MusicPageClient.test.tsx`
  - 覆盖卡片主体点击进入详情
  - 覆盖播放 icon 点击后直接调用歌单详情接口并整组播放
  - 覆盖 Jamendo disabled 时自动切换到可用来源
- `src/app/api/music/routes.test.ts`
  - 覆盖 Jamendo suspended 响应
  - 覆盖 sources API 返回 disabled Jamendo
- `src/components/music/MusicPlayerRoot.test.tsx`
  - 保持当前播放链稳定
  - 覆盖展开 / 收起 / 停止 / 关闭动作
- 需要时补充 `MusicMiniPlayer` / `MusicFullscreenPlayer` 组件交互测试：
  - 播放暂停
  - 上一首下一首
  - 队列切歌
  - 歌词 / 队列切换

**验收标准**

- 点击歌单播放 icon 时，不进入歌单详情，直接开始播放该歌单
- 点击歌单卡片主体时，仍然进入歌单详情
- Jamendo suspended 时，页面不再显示原始英文 API 错误
- Jamendo 失效后，来源会自动降级并回退到其他可用平台
- mini player 结构、按钮分区和视觉风格贴近参考图
- expanded player 与 mini player 使用统一视觉语言
- 自动化测试覆盖新增关键路径，并通过本地验证
