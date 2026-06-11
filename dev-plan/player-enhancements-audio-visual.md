# 播放增强开发文档

## 目标

为 LunaTV 增加两个默认关闭、按需开启的播放增强能力：

1. `去磨皮修正`
   目标是减轻国产综艺中常见的过度磨皮、过白高光和塑料感。
2. `音量突增保护`
   目标是压制广告插入、突然激昂的背景音乐、唱歌片段带来的明显增响。

两个能力都要求：

- 关闭时不主动启用对应处理链。
- 开启后可在当前会话即时生效。
- 桌面版优先由 Rust 本地服务提供默认值。

## 实现概览

### 配置层

Rust 本地服务新增了独立配置块：

```json
{
  "player_enhancements": {
    "audio_spike_protection": false,
    "visual_enhancement": false
  }
}
```

相关路径：

- `config.example.json`
- `crates/moontv-local-service/src/lib.rs`

本地服务会把这两个默认值投影到 `/api/runtime/public-config`，前端再合并到 `window.RUNTIME_CONFIG`。

前端运行时字段：

- `PLAYER_AUDIO_SPIKE_PROTECTION`
- `PLAYER_VISUAL_ENHANCEMENT`

### 偏好存储层

前端新增了统一偏好 helper：

- `src/lib/player-enhancements.ts`

职责：

- 读取运行时默认值
- 读取/写入本地 `localStorage`
- 通过 `lunatv:player-enhancements-updated` 广播设置变化

本地存储 key：

- `playerAudioSpikeProtectionEnabled`
- `playerVisualEnhancementEnabled`

### 播放处理层

新增统一播放器增强管理器：

- `src/lib/player-enhancement-runtime.ts`

它会在播放器拿到真实 `HTMLVideoElement` 后绑定两条可独立开关的处理链：

1. 音频链

   - `MediaElementSource`
   - `AnalyserNode`
   - `DynamicsCompressorNode`
   - `GainNode`
   - `destination`

   行为：

   - 对音频短时响度做滚动基线估计
   - 当检测到相对基线明显抬升时，快速下压
   - 恢复时采用较慢释放，减少忽大忽小

2. 视频链

   - 优先使用 `WebGL shader`
   - 不可用时回退到 `Canvas2D`

   行为：

   - 轻度局部锐化，减轻磨皮导致的边缘发糊
   - 压低高亮区域的过白倾向
   - 对低饱和高亮肤色做轻微暖化修正

## 页面接入

### 全局设置

`src/components/UserMenu.tsx`

新增两个本地设置项：

- `音量突增保护`
- `去磨皮修正`

### 点播页

`src/app/play/page.tsx`

点播页接入了完整增强链，并在 ArtPlayer 设置菜单里增加了两个快速开关：

- `音量突增保护`
- `去磨皮修正`

适合播放中快速验证效果。

### 直播页

`src/app/live/page.tsx`

直播页复用了同一个增强管理器，跟随全局设置生效。

## 关闭时的行为

### 音量突增保护

- 从未开启过：不创建音频图处理链。
- 已经开启过再关闭：保留最小直通链路，停止分析与压制逻辑，不再主动衰减音量。

### 去磨皮修正

- 不创建覆盖 canvas
- 不隐藏原始 video
- 不跑逐帧渲染循环

## 已知边界

1. `去磨皮修正` 是“减轻失真”，不是“无损还原”
   被源视频编码和滤镜抹掉的细节无法真正恢复。

2. 画面修正基于本地逐帧处理
   在低端设备上会有额外 GPU/CPU 开销。

3. 音量保护基于浏览器 Web Audio
   第一次启用时仍可能受浏览器手势策略影响，但处理链会在后续播放/交互中自动补齐。

4. 画中画和远程投屏场景
   仍以原始 `video` 元素为主，增强效果不保证完全一致。

## 验证项

已完成的基础验证：

- `pnpm typecheck`
- `cargo check --workspace`
- `pnpm test -- --runTestsByPath src/lib/player-enhancements.test.ts`
- `cargo test -p moontv-local-service runtime_public_config_endpoint_projects_desktop_settings`
- 改动文件 ESLint 检查通过

## 后续可选优化

1. 为两项增强增加强度档位，而不只是布尔开关。
2. 给播放器内增加增强状态提示，让用户知道当前是否处于修正模式。
3. 对桌面端补充离线转码增强方案，仅用于下载内容，不进入在线播放链路。
