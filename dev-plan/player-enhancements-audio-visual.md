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
- 桌面版需要兼容网页全屏、窗口全屏以及 Windows / macOS 的显示比例。

## 实现概览

### 配置层

Rust 本地服务新增了独立配置块，并升级为级别化配置：

```json
{
  "player_enhancements": {
    "audio_spike_protection_level": "standard",
    "visual_enhancement_level": "off"
  }
}
```

相关路径：

- `config.example.json`
- `crates/moontv-local-service/src/lib.rs`

本地服务会把默认级别和布尔兼容位同时投影到 `/api/runtime/public-config`，前端再合并到 `window.RUNTIME_CONFIG`。

前端运行时字段：

- `PLAYER_AUDIO_SPIKE_PROTECTION`
- `PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL`
- `PLAYER_VISUAL_ENHANCEMENT`
- `PLAYER_VISUAL_ENHANCEMENT_LEVEL`

### 偏好存储层

前端新增了统一偏好 helper：

- `src/lib/player-enhancements.ts`

职责：

- 读取运行时默认值
- 读取/写入本地 `localStorage`
- 兼容旧版布尔开关存储
- 通过 `lunatv:player-enhancements-updated` 广播设置变化

本地存储 key：

- `playerAudioSpikeProtectionLevel`
- `playerVisualEnhancementLevel`

兼容读取的旧 key：

- `playerAudioSpikeProtectionEnabled`
- `playerVisualEnhancementEnabled`

### 播放处理层

新增统一播放器增强管理器：

- `src/lib/player-enhancement-runtime.ts`

它会在播放器拿到真实 `HTMLVideoElement` 后绑定两条可独立分级的处理链：

1. 音频链

   - `MediaElementSource`
   - `AnalyserNode`
   - `DynamicsCompressorNode`
   - `GainNode`
   - `destination`

   行为：

   - 对音频短时响度做滚动基线估计
   - 根据 `light / standard / strong` 档位设置 ceiling、触发阈值和压缩强度
   - 当检测到相对基线明显抬升或峰值超过 ceiling 时，快速下压
   - 恢复时采用较慢释放，减少忽大忽小
   - 把当前峰值 dBFS、压制量和上限状态回传给前端 overlay

2. 视频链

   - 优先使用 `WebGL shader`
   - 不可用时回退到 `Canvas2D`

   行为：

   - 轻度局部锐化，减轻磨皮导致的边缘发糊
   - 压低高亮区域的过白倾向
   - 对低饱和高亮肤色做轻微暖化修正
   - 根据 `light / standard / strong` 调整修正强度
   - 逐帧按原视频宽高比做 `aspect-fit` 绘制，保留原有黑边，不再拉伸画面
   - 覆盖层位于原视频上方但不隐藏原视频，减少 Windows / macOS 全屏黑屏风险

3. 桌面全屏链路

   - Tauri capability 允许 `is_fullscreen / set_fullscreen / set_simple_fullscreen`
   - 桌面端原生全屏按钮改为自定义控制，避免浏览器原生全屏在 Tauri 内部显示不支持
   - macOS 优先走 `setSimpleFullscreen`，其他平台走 `setFullscreen`

## 页面接入

### 全局设置

`src/components/UserMenu.tsx`

新增两个本地设置项，并改为级别按钮：

- `音量突增保护`
- `去磨皮修正`

### 点播页

`src/app/play/page.tsx`

点播页接入了完整增强链，并在 ArtPlayer 设置菜单里增加了两个快速级别选择器：

- `音量突增保护`
- `去磨皮修正`

同时新增播放中状态浮层：

- 当前峰值 `dBFS`
- ceiling 上限
- 当前压制量
- 是否正在限制

桌面端原生全屏改为自定义控制按钮，快捷键 `f` 也会优先切换窗口全屏。

### 直播页

`src/app/live/page.tsx`

直播页复用了同一个增强管理器，跟随全局设置生效，并显示相同的 dB 状态浮层。

## 关闭时的行为

- 音量突增保护关闭：停止分析和额外增益衰减，恢复直通输出。
- 去磨皮修正关闭：销毁覆盖 canvas，停止逐帧渲染。
- 两者关闭：原始音视频路径不再附加增强处理。

## 已知边界

1. `去磨皮修正` 是“减轻失真”，不是“无损还原”
   被源视频编码和滤镜抹掉的细节无法真正恢复。

2. 画面修正基于本地逐帧处理
   在低端设备上会有额外 GPU/CPU 开销。

3. 音量保护基于浏览器 Web Audio
   第一次启用时仍可能受浏览器手势策略影响，但处理链会在后续播放/交互中自动补齐。

4. 画中画和远程投屏场景
   仍以原始 `video` 元素为主，增强效果不保证完全一致。

5. dB overlay 反映的是本地播放器分析值
   主要用于相对监测和验证效果，不作为绝对声学测量结果。

## 验证项

已完成的基础验证：

- `pnpm typecheck`
- `cargo check --workspace`
- `pnpm test -- --runTestsByPath src/lib/player-enhancements.test.ts src/lib/player-enhancement-runtime.test.ts`
- `cargo test -p moontv-local-service runtime_public_config_endpoint_projects_desktop_settings`
- 改动文件 ESLint 检查通过

## 后续可选优化

1. 为音量保护增加用户可调 ceiling 自定义值，而不只依赖预设档位。
2. 记录每种视频源的用户偏好，允许按资源类型自动套用默认档位。
3. 对桌面端补充离线转码增强方案，仅用于下载内容，不进入在线播放链路。
