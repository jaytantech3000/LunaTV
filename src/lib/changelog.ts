// 此文件由 scripts/convert-changelog.js 自动生成
// 请勿手动编辑

export type ChangelogLocale = 'zh-CN' | 'en';

export interface LocalizedChangelogItems {
  zhCN: string[];
  en: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  added: LocalizedChangelogItems;
  changed: LocalizedChangelogItems;
  fixed: LocalizedChangelogItems;
}

export function getLocalizedChangelogItems(
  items: LocalizedChangelogItems,
  locale: ChangelogLocale
) {
  if (locale === 'en') {
    return items.en.length > 0 ? items.en : items.zhCN;
  }

  return items.zhCN.length > 0 ? items.zhCN : items.en;
}

export const changelog: ChangelogEntry[] = [
  {
    version: '200.0.0',
    date: '2026-06-16',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        '桌面版版本号现在从独立的 200.x 版本线开始。',
        '桌面版更新发现现改为使用独立的更新清单分支。',
        '桌面版预发布构建现在使用 semver 预发布后缀，例如 `200.0.0-beta.1`。',
      ],
      en: [
        'Desktop versioning now starts from an independent 200.x line.',
        'Desktop updater discovery now uses a dedicated updater manifest branch.',
        'Desktop prerelease builds now follow semver prerelease suffixes such as `200.0.0-beta.1`.',
      ],
    },
    fixed: {
      zhCN: ['避免应用内更新器不可用时出现互相冲突的更新提示。'],
      en: [
        'Avoid conflicting update messages when the in-app updater cannot be used.',
      ],
    },
  },
  {
    version: '100.1.3',
    date: '2026-05-28',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: [
        '修复首页热门电影、热门剧集、热门综艺在番剧接口失败时一并空白的问题',
        '番剧日历改为通过服务端代理请求，规避 bgm.tv 的 CORS 限制',
      ],
      en: [
        'Fix an issue where the homepage hot movie, hot series, and hot variety sections all went blank when the Bangumi API failed.',
        'Route Bangumi calendar requests through the server to avoid `bgm.tv` CORS restrictions.',
      ],
    },
  },
  {
    version: '100.1.2',
    date: '2026-03-15',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        '移除豆瓣图片代理中的「直连」和「豆瓣官方精品 CDN」选项，历史数据自动兼容为服务器代理',
      ],
      en: [
        'Remove the "Direct" and "Douban Official Premium CDN" options from the Douban image proxy, and automatically migrate historical data to the server proxy mode.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '100.1.1',
    date: '2026-02-27',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['搜索页使用虚拟滚动，优化滚动性能'],
      en: [
        'Use virtual scrolling on the search page to improve scrolling performance.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '100.1.0',
    date: '2026-02-27',
    added: {
      zhCN: ['管理面板新增开关支持关闭网页直播'],
      en: ['Add an admin panel toggle to disable web live streaming.'],
    },
    changed: {
      zhCN: [
        '优化用户数据存储结构，加速数据获取',
        '用户密码加盐存储',
        '新增数据自动迁移',
      ],
      en: [
        'Optimize the user data storage structure to speed up data access.',
        'Store user passwords with salting.',
        'Add automatic data migration.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '100.0.3',
    date: '2025-10-27',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复 webkit 下播放器控件的展示 bug'],
      en: ['Fix a player controls display bug in WebKit.'],
    },
  },
  {
    version: '100.0.2',
    date: '2025-10-23',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复 /api/search/resources 接口越权问题'],
      en: ['Fix an unauthorized access issue in `/api/search/resources`.'],
    },
  },
  {
    version: '100.0.1',
    date: '2025-09-25',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: [
        '修复错误的环境变量 ADMIN_USERNAME',
        '修复 bangumi 数据中没有图片导致首页崩溃问题',
      ],
      en: [
        'Fix the incorrect `ADMIN_USERNAME` environment variable.',
        'Fix a homepage crash caused by Bangumi items without images.',
      ],
    },
  },
  {
    version: '100.0.0',
    date: '2025-08-26',
    added: {
      zhCN: [
        '新增对 SITE_BASE 环境变量的支持，解决 m3u8 重写时 base url 错误的问题',
      ],
      en: [
        'Add support for the `SITE_BASE` environment variable to fix incorrect base URLs during m3u8 rewriting.',
      ],
    },
    changed: {
      zhCN: ['移除授权相关逻辑', '移除代码混淆', '移除 melody-cdn-sharon'],
      en: [
        'Remove authorization-related logic.',
        'Remove code obfuscation.',
        'Remove `melody-cdn-sharon`.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '4.3.0',
    date: '2025-08-26',
    added: {
      zhCN: ['支持将 IPTV 频道添加到收藏中'],
      en: ['Support adding IPTV channels to favorites.'],
    },
    changed: {
      zhCN: ['禁用 flv 直播，仅支持 m3u8 直播', '降低代理 ts 分片的内存占用'],
      en: [
        'Disable FLV live streaming and only support m3u8 live streaming.',
        'Reduce memory usage when proxying TS segments.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '4.2.1',
    date: '2025-08-26',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复直播源加载失败或离开页面后依然无限加载的问题'],
      en: [
        'Fix an issue where live sources kept loading indefinitely after a load failure or after leaving the page.',
      ],
    },
  },
  {
    version: '4.2.0',
    date: '2025-08-26',
    added: {
      zhCN: [
        '支持 flv 直播和直播地址解析到 mp4 的处理',
        '增加直播台标的 proxy 以防止 cors',
        '支持播放页选集分组的滚动翻页',
      ],
      en: [
        'Support FLV live streams and processing live stream URLs resolved to mp4.',
        'Add a proxy for live channel logos to avoid CORS issues.',
        'Support scroll-based pagination for episode groups on the playback page.',
      ],
    },
    changed: {
      zhCN: ['管理后台页面的按钮增加加载中的 UI'],
      en: ['Add loading-state UI to buttons in the admin page.'],
    },
    fixed: {
      zhCN: ['/api/proxy/m3u8 仅对 m3u8 内容反序列化，降低内存和 CPU 消耗'],
      en: [
        'Only deserialize m3u8 content in `/api/proxy/m3u8` to reduce memory and CPU usage.',
      ],
    },
  },
  {
    version: '4.1.1',
    date: '2025-08-25',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['增加对 url-tvg 和多 epg url 的支持'],
      en: ['Add support for `url-tvg` and multiple EPG URLs.'],
    },
    fixed: {
      zhCN: ['修复 epg 数据清洗中去重叠逻辑未考虑日期导致的问题'],
      en: [
        'Fix an issue where EPG deduplication logic did not account for dates.',
      ],
    },
  },
  {
    version: '4.1.0',
    date: '2025-08-24',
    added: {
      zhCN: ['解析 m3u 自带的 epg 和自定义 epg，增加今日节目单'],
      en: [
        'Parse built-in and custom EPG data from m3u files and add a today schedule list.',
      ],
    },
    changed: {
      zhCN: ['直播源数据刷新改为并发刷新'],
      en: ['Refresh live source data concurrently.'],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '4.0.0',
    date: '2025-08-24',
    added: {
      zhCN: ['增加 iptv 订阅和播放功能'],
      en: ['Add IPTV subscription and playback support.'],
    },
    changed: {
      zhCN: [
        '搜索页面视频卡片移动端/右键菜单添加豆瓣链接',
        '搜索建议遵循色情过滤',
      ],
      en: [
        'Add Douban links to the video card mobile menu and right-click menu.',
        'Make search suggestions respect adult-content filtering.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '3.2.1',
    date: '2025-08-22',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['新增色色过滤分类', '调整搜索建议框层级'],
      en: [
        'Add an adult-content filtering category.',
        'Adjust the stacking order of the search suggestion panel.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '3.2.0',
    date: '2025-08-22',
    added: {
      zhCN: [
        '视频源管理支持批量启用、禁用、删除',
        '用户管理支持批量设置用户组',
        '视频卡片右键/长按菜单新增新标签页播放',
      ],
      en: [
        'Support batch enable, disable, and delete actions in source management.',
        'Support batch user group assignment in user management.',
        'Add a "play in new tab" action to the video card right-click and long-press menu.',
      ],
    },
    changed: {
      zhCN: [
        '视频卡片移动端 hover 时仅保留播放按钮',
        '微调管理页面 UI 和视频卡片右键/长按菜单中的收藏样式',
      ],
      en: [
        'On mobile, keep only the play button when video cards enter the hover state.',
        'Fine-tune the admin page UI and the favorite style in the video card right-click and long-press menu.',
      ],
    },
    fixed: {
      zhCN: ['修复了搜索栏 enter 键自动选中第一个建议项的问题'],
      en: [
        'Fix an issue where pressing Enter in the search bar automatically selected the first suggestion.',
      ],
    },
  },
  {
    version: '3.1.2',
    date: '2025-08-22',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复移动端卡片无法点击的问题'],
      en: ['Fix an issue where video cards could not be clicked on mobile.'],
    },
  },
  {
    version: '3.1.1',
    date: '2025-08-21',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复了视频卡片 hover 的非播放按钮点击后进入播放页的问题'],
      en: [
        'Fix an issue where clicking non-play buttons in the video card hover state still opened the playback page.',
      ],
    },
  },
  {
    version: '3.1.0',
    date: '2025-08-21',
    added: {
      zhCN: [
        '增加用户组管理和用户组播放源限制',
        '增加管理面板视频源有效性检查',
        '搜索栏增加一键删除按钮',
      ],
      en: [
        'Add user group management and per-group video source restrictions.',
        'Add video source validity checks in the admin panel.',
        'Add a one-click clear button to the search bar.',
      ],
    },
    changed: {
      zhCN: [
        '放宽授权心跳对于网络问题的判断标准',
        '统一管理面板弹窗使用 createPortal',
        'VideoCard 允许移动端响应 hover 事件',
        '移动端布局 header 常驻，搜索按钮移动到 header 右侧',
        '调大搜索接口超时时间',
      ],
      en: [
        'Relax the license heartbeat criteria for transient network failures.',
        'Standardize admin panel dialogs on `createPortal`.',
        'Allow `VideoCard` to respond to hover on mobile.',
        'Keep the header pinned in the mobile layout and move the search button to the right side of the header.',
        'Increase the search API timeout.',
      ],
    },
    fixed: {
      zhCN: ['修复 bangumi 返回的整数评分无小数导致 UI 不对齐的问题'],
      en: [
        'Fix UI misalignment when Bangumi returns integer ratings without decimals.',
      ],
    },
  },
  {
    version: '3.0.2',
    date: '2025-08-20',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['优化机器码生成逻辑'],
      en: ['Optimize the machine identifier generation logic.'],
    },
    fixed: {
      zhCN: ['修复 redis url 不支持 rediss 协议的问题'],
      en: [
        'Fix the issue where Redis URLs did not support the `rediss` protocol.',
      ],
    },
  },
  {
    version: '3.0.1',
    date: '2025-08-20',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复授权初始化错误'],
      en: ['Fix an authorization initialization error.'],
    },
  },
  {
    version: '3.0.0',
    date: '2025-08-20',
    added: {
      zhCN: ['防盗卖加固', '支持自定义用户可用视频源'],
      en: [
        'Harden anti-resale protection.',
        'Support custom video source availability per user.',
      ],
    },
    changed: {
      zhCN: ['右键视频卡片可弹出操作菜单'],
      en: ['Open an action menu by right-clicking a video card.'],
    },
    fixed: {
      zhCN: ['过滤掉集数为 0 的搜索结果'],
      en: ['Filter out search results whose episode count is `0`.'],
    },
  },
  {
    version: '2.7.1',
    date: '2025-08-17',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复 iOS 下版本面板可穿透滚动背景的问题'],
      en: [
        'Fix an issue where the version panel allowed background scrolling on iOS.',
      ],
    },
  },
  {
    version: '2.7.0',
    date: '2025-08-17',
    added: {
      zhCN: ['视频卡片新增移动端操作面板，优化触控屏操作体验'],
      en: [
        'Add a mobile action panel to video cards to improve touch interaction.',
      ],
    },
    changed: {
      zhCN: ['优化集数标题的匹配和展示逻辑'],
      en: ['Optimize episode title matching and display logic.'],
    },
    fixed: {
      zhCN: ['修复设置面板和修改密码面板背景可被拖动的问题'],
      en: [
        'Fix an issue where the settings panel and change-password panel still allowed dragging the background.',
      ],
    },
  },
  {
    version: '2.6.0',
    date: '2025-08-17',
    added: {
      zhCN: [
        '新增搜索流式输出接口，并设置流式搜索为默认搜索接口，优化搜索体验',
        '新增源站搜索结果内存缓存，粒度为源站+关键词+页数，缓存 10 分钟',
        '新增豆瓣 CDN provided by @JohnsonRan',
      ],
      en: [
        'Add a streaming search API and make it the default search endpoint to improve search UX.',
        'Add an in-memory cache for source-site search results keyed by source, keyword, and page, with a 10-minute TTL.',
        'Add a Douban CDN provided by `@JohnsonRan`.',
      ],
    },
    changed: {
      zhCN: [
        '搜索结果默认为无排序状态，不再默认按照年份排序',
        '常规搜索接口无结果时，不再设置响应的缓存头',
        '移除豆瓣数据源中的 cors-anywhere 方式',
      ],
      en: [
        'Make search results default to an unsorted state instead of sorting by year.',
        'Stop setting cache headers when the regular search API returns no results.',
        'Remove the `cors-anywhere` mode from the Douban data source.',
      ],
    },
    fixed: {
      zhCN: [
        '数据导出时导出站长密码，保证迁移到新账户时原站长用户可正常登录',
        '聚合卡片优化移动端源信息展示',
      ],
      en: [
        'Export the site owner password during data export so the original owner can still log in after migrating to a new account.',
        'Optimize source information display on aggregate cards for mobile.',
      ],
    },
  },
  {
    version: '2.4.1',
    date: '2025-08-15',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: [
        '对导入和 db 读取的配置文件做自检，防止 USERNAME 修改导致用户状态异常',
      ],
      en: [
        'Add self-checks for imported and database-loaded config files to prevent user state issues after changing `USERNAME`.',
      ],
    },
  },
  {
    version: '2.4.0',
    date: '2025-08-15',
    added: {
      zhCN: ['支持 kvrocks 存储（持久化 kv 存储）'],
      en: ['Support Kvrocks storage as a persistent KV backend.'],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: [
        '修复搜索结果排序不稳定的问题',
        '导入数据时同时更新内存缓存的管理员配置',
      ],
      en: [
        'Fix unstable search result ordering.',
        'Update the in-memory admin config cache when importing data.',
      ],
    },
  },
  {
    version: '2.3.0',
    date: '2025-08-15',
    added: {
      zhCN: ['支持站长导入导出整站数据'],
      en: ['Support full-site data import and export for the site owner.'],
    },
    changed: {
      zhCN: ['仅允许站长操作配置文件', '微调搜索结果过滤面板的移动端样式'],
      en: [
        'Restrict config file operations to the site owner only.',
        'Fine-tune the mobile styles of the search result filter panel.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '2.2.1',
    date: '2025-08-14',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复了筛选 panel 打开时滚动页面 panel 不跟随的问题'],
      en: [
        'Fix an issue where the filter panel did not stay aligned while the page scrolled with the panel open.',
      ],
    },
  },
  {
    version: '2.2.0',
    date: '2025-08-14',
    added: {
      zhCN: [
        '搜索结果支持按播放源、标题和年份筛选，支持按年份排序',
        '搜索界面视频卡片展示年份信息，聚合卡片展示播放源',
      ],
      en: [
        'Support filtering search results by source, title, and year, and support sorting by year.',
        'Show year information on search result video cards and source information on aggregate cards.',
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: [
        '修复 /api/search/resources 返回空的问题',
        '修复 upstash 实例无法编辑自定义分类的问题',
      ],
      en: [
        'Fix `/api/search/resources` returning empty results.',
        'Fix the issue where Upstash instances could not edit custom categories.',
      ],
    },
  },
  {
    version: '2.1.0',
    date: '2025-08-13',
    added: {
      zhCN: ['支持通过订阅获取配置文件'],
      en: ['Support fetching config files through subscriptions.'],
    },
    changed: {
      zhCN: ['微调部分文案和 UI', '删除部分无用代码'],
      en: ['Fine-tune some copy and UI.', 'Remove unused code.'],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '2.0.1',
    date: '2025-08-13',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['版本检查和变更日志请求 Github'],
      en: ['Route version checks and changelog requests through GitHub.'],
    },
    fixed: {
      zhCN: ['微调管理面板样式'],
      en: ['Fine-tune the admin panel styles.'],
    },
  },
  {
    version: '2.0.0',
    date: '2025-08-13',
    added: {
      zhCN: [
        '支持配置文件在线配置和编辑',
        '搜索页搜索框实时联想',
        '去除对 localstorage 模式的支持',
      ],
      en: [
        'Support online configuration and editing of config files.',
        'Add real-time suggestions to the search box on the search page.',
        'Remove support for localstorage mode.',
      ],
    },
    changed: {
      zhCN: ['播放记录删除按钮改为垃圾桶图标以消除歧义'],
      en: [
        'Change the delete button for play records to a trash icon to reduce ambiguity.',
      ],
    },
    fixed: {
      zhCN: ['限制设置面板的最大长度，防止超出视口'],
      en: [
        'Limit the maximum size of the settings panel to prevent it from overflowing the viewport.',
      ],
    },
  },
  {
    version: '1.1.1',
    date: '2025-08-12',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['修正 zwei 提供的 cors proxy 地址', '移除废弃代码'],
      en: [
        'Correct the CORS proxy URL provided by zwei.',
        'Remove deprecated code.',
      ],
    },
    fixed: {
      zhCN: ['[运维] docker workflow release 日期使用东八区日期'],
      en: ['[Ops] Use the UTC+8 date for Docker workflow releases.'],
    },
  },
  {
    version: '1.1.0',
    date: '2025-08-12',
    added: {
      zhCN: ['每日新番放送功能，展示每日新番放送的番剧'],
      en: [
        'Add a daily anime airing feature that shows the daily airing schedule.',
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复远程 CHANGELOG 无法提取变更内容的问题'],
      en: [
        'Fix the issue where the remote `CHANGELOG` could not extract change details.',
      ],
    },
  },
  {
    version: '1.0.5',
    date: '2025-08-12',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['实现基于 Git 标签的自动 Release 工作流'],
      en: ['Implement an automatic release workflow based on Git tags.'],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '1.0.4',
    date: '2025-08-11',
    added: {
      zhCN: ['优化版本管理工作流，实现单点修改'],
      en: [
        'Optimize the version management workflow for single-point modification.',
      ],
    },
    changed: {
      zhCN: ['版本号现在从 CHANGELOG 自动提取，无需手动维护 VERSION.txt'],
      en: [
        'Version numbers are now extracted automatically from `CHANGELOG`, so `VERSION.txt` no longer needs to be maintained manually.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '1.0.3',
    date: '2025-08-11',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: ['升级播放器 Artplayer 至版本 5.2.5'],
      en: ['Upgrade the player `Artplayer` to version `5.2.5`.'],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '1.0.2',
    date: '2025-08-11',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        '版本号比较机制恢复为数字比较，仅当最新版本大于本地版本时才认为有更新',
        '[运维] 自动替换 version.ts 中的版本号为 VERSION.txt 中的版本号',
      ],
      en: [
        'Restore numeric version comparison so an update is detected only when the latest version is greater than the local version.',
        '[Ops] Automatically replace the version in `version.ts` with the version from `VERSION.txt`.',
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
  {
    version: '1.0.1',
    date: '2025-08-11',
    added: {
      zhCN: [
        // 无新增内容
      ],
      en: [
        // No added entries
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: ['修复版本检查功能，只要与最新版本号不一致即认为有更新'],
      en: [
        'Fix version checking so any mismatch with the latest version is treated as an update.',
      ],
    },
  },
  {
    version: '1.0.0',
    date: '2025-08-10',
    added: {
      zhCN: [
        '基于 Semantic Versioning 的版本号机制',
        '版本信息面板，展示本地变更日志和远程更新日志',
      ],
      en: [
        'Introduce a versioning scheme based on Semantic Versioning.',
        'Add a version information panel that shows the local changelog and remote changelog.',
      ],
    },
    changed: {
      zhCN: [
        // 无变更内容
      ],
      en: [
        // No changed entries
      ],
    },
    fixed: {
      zhCN: [
        // 无修复内容
      ],
      en: [
        // No fixed entries
      ],
    },
  },
];

export default changelog;
