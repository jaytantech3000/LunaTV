# 豆瓣 + IMDb + Rotten Tomatoes 评分集成方案

## 目标

在搜索结果页和播放详情页同时展示以下三类评分：

- 豆瓣评分
- IMDb 评分
- Rotten Tomatoes `Tomatometer`

本方案只定义实施路径，不直接改动现有代码。

## 设计原则

1. 搜索主链路先返回片源结果，评分异步补齐，避免拖慢首屏搜索。
2. 评分数据通过统一聚合层输出，前端不直接依赖具体评分源。
3. 先解决条目匹配，再请求评分；不把“找同一部片”和“拿评分”混在一起。
4. 敏感配置和授权信息只保留在服务端，不下发到前端。
5. Rotten Tomatoes 只展示 `Tomatometer`，UI 按百分比展示，不与 10 分制混用。

## 当前代码现状

- 搜索页已经支持“结果先到，评分后补”的模式，但目前只服务于豆瓣评分。
- 搜索结果数据模型里已有 `douban_id`，没有 `imdb_id` 和 `rt_id`。
- 卡片组件当前只支持单个 `rate` 字段，不适合同时展示三种评分。
- 豆瓣评分缓存是独立的内存缓存，还没有统一评分聚合层。
- 现有 `IStorage` 更偏用户数据，不适合直接承载全站评分聚合缓存。

相关文件：

- [src/lib/types.ts](/Users/jay/Code/LunaTV/src/lib/types.ts:82)
- [src/app/search/page.tsx](/Users/jay/Code/LunaTV/src/app/search/page.tsx:42)
- [src/components/VideoCard.tsx](/Users/jay/Code/LunaTV/src/components/VideoCard.tsx:1)
- [src/lib/douban-rating.ts](/Users/jay/Code/LunaTV/src/lib/douban-rating.ts:1)
- [src/app/api/douban/ratings/route.ts](/Users/jay/Code/LunaTV/src/app/api/douban/ratings/route.ts:1)

## 总体架构

新增一层统一评分聚合服务：

- 前端统一请求 `/api/ratings/batch`
- 服务端先做条目匹配
- 匹配成功后分别读取豆瓣、IMDb、RT 评分
- 服务端合并结果并缓存
- 前端只展示统一结构，不关心底层来自哪个 provider

数据流：

1. 搜索接口返回片源结果
2. 前端收集 `title/year/type/douban_id`
3. 前端批量请求 `/api/ratings/batch`
4. 服务端解析外部 ID
5. 服务端查询各评分源
6. 服务端返回统一评分结构
7. 搜索卡片和播放详情页渲染评分

## 统一数据模型

建议新增以下模型：

```ts
type ExternalIds = {
  douban_id?: string;
  imdb_id?: string;
  rt_id?: string;
  rt_slug?: string;
};

type RatingEntry = {
  source: 'douban' | 'imdb' | 'rt';
  label: string;
  value: number;
  scale: 10 | 100;
  votes?: number;
  kind?: 'user' | 'critic' | 'tomatometer' | 'popcornmeter';
  url?: string;
  updated_at: number;
};

type RatingsBundle = {
  douban?: RatingEntry;
  imdb?: RatingEntry;
  rt?: RatingEntry;
};

type ResolvedRatingPayload = {
  external_ids: ExternalIds;
  ratings: RatingsBundle;
  match: {
    strategy: string;
    confidence: number;
  };
  stale?: boolean;
};
```

## 评分源接入策略

### 豆瓣

- 继续沿用现有实现
- 将当前 `src/lib/douban-rating.ts` 从“返回字符串”升级为“返回结构化评分对象”
- 作为最先接入统一聚合层的 provider

### IMDb

两种接入模式：

- 自用 / 非商业：使用 IMDb 官方 datasets，同步 `title.ratings.tsv.gz`
- 公开部署 / 商业使用：使用 IMDb 官方 API

实现上建议先抽象 provider 接口，再决定底层是 dataset 还是官方 API。

### Rotten Tomatoes

- 只展示 `Tomatometer`
- `Popcornmeter` 仅考虑放在详情页，不作为搜索页主评分
- 应基于授权的 data feed 或官方许可数据源接入
- UI 只显示文本百分比，例如 `RT 92%`

## 匹配与归一化策略

这是整个方案里最关键的部分。

### 新增匹配层

新增两层：

- `title-normalize`
- `title-match`

### 归一化规则

至少处理以下问题：

- 空格和多余符号
- 中文括号 / 英文括号
- 全角半角
- 大小写
- 季数 / 篇章后缀
- 原名 / 别名 / 副标题

### 匹配优先级

1. 手工 override
2. 已缓存映射
3. `douban_id` 为锚点反查外部 ID
4. `标题 + 年份 + 类型` 精确匹配
5. 标题近似匹配

### 风险控制

- 低置信度匹配不写死映射
- 允许只返回豆瓣和 IMDb，不强行拼 RT
- 后续保留人工修正入口

## 缓存设计

评分缓存和用户数据存储分离。

### 不建议的做法

- 不把三方评分直接塞进现有 `IStorage`
- 不把大体量索引直接放进用户态存储抽象

### 建议的缓存层

新增 `ratings-cache`，优先级如下：

1. Redis / Kvrocks / Upstash 共享缓存
2. Node 进程内内存缓存

### 建议 key

- `ratings:resolve:v1:{hash}`
- `ratings:douban:{id}`
- `ratings:imdb:{id}`
- `ratings:rt:{id}`

### 建议 TTL

- 豆瓣：6 小时
- IMDb：24 小时
- RT：12 到 24 小时
- 条目匹配结果：24 小时

## API 设计

### 新接口

`POST /api/ratings/batch`

请求体示例：

```json
{
  "items": [
    {
      "key": "search-1",
      "title": "流浪地球2",
      "year": "2023",
      "type": "movie",
      "douban_id": "35267208"
    }
  ]
}
```

返回体示例：

```json
{
  "items": {
    "search-1": {
      "external_ids": {
        "douban_id": "35267208",
        "imdb_id": "tt13539646",
        "rt_slug": "the_wandering_earth_ii"
      },
      "ratings": {
        "douban": { "source": "douban", "label": "豆瓣", "value": 8.3, "scale": 10, "updated_at": 0 },
        "imdb": { "source": "imdb", "label": "IMDb", "value": 7.9, "scale": 10, "updated_at": 0 },
        "rt": { "source": "rt", "label": "RT", "value": 80, "scale": 100, "kind": "tomatometer", "updated_at": 0 }
      },
      "match": {
        "strategy": "douban_id+year",
        "confidence": 0.98
      }
    }
  }
}
```

### 兼容策略

- 保留当前 `/api/douban/ratings`
- 将其逐步转为统一评分聚合层的兼容包装
- 等搜索页和播放页全部迁移完成后再考虑删除

## UI 方案

### 搜索页

不建议在海报右上角堆三个评分角标。推荐：

- 保留年份和集数徽章逻辑
- 在标题下方增加一行评分标签
- 展示格式：
  - `豆瓣 8.6`
  - `IMDb 7.9`
  - `RT 92%`

### 播放详情页

在详情头部增加完整评分区：

- `豆瓣 8.6`
- `IMDb 7.9/10 · 12.4万票`
- `RT 92% Tomatometer`

### UI 约束

- RT 不使用“10 分制”文案
- 三源评分风格统一，但含义不混淆
- 没拿到数据时直接隐藏，不显示空占位

## 配置设计

### 新增公开开关

建议在 `SiteConfig` 中增加：

- `ShowDoubanRating`
- `ShowImdbRating`
- `ShowRtRating`

### 不放进前端配置的内容

以下内容只保留在环境变量或服务端：

- IMDb API key 或 dataset 路径
- RT feed 凭证或授权信息
- provider 内部调试配置

## 按文件拆分的改动规划

### P0：统一评分链路落地，但内部先只接豆瓣

- [src/lib/types.ts](/Users/jay/Code/LunaTV/src/lib/types.ts:82)
  - 增加统一评分模型
- `src/lib/ratings-cache.ts`
  - 新增评分缓存层
- `src/lib/ratings-resolver.ts`
  - 新增评分聚合入口
- `src/app/api/ratings/batch/route.ts`
  - 新增统一 batch API
- [src/app/search/page.tsx](/Users/jay/Code/LunaTV/src/app/search/page.tsx:42)
  - 搜索页改接统一评分接口
- [src/components/VideoCard.tsx](/Users/jay/Code/LunaTV/src/components/VideoCard.tsx:1)
  - 新增 `ratings` 展示能力

目标：

- 保持现有豆瓣评分功能不回退
- 完成统一评分链路替换

### P1：接入 IMDb

- `src/lib/imdb-rating.ts`
  - 新增 IMDb provider
- `src/lib/title-normalize.ts`
  - 新增标题归一层
- `src/lib/title-match.ts`
  - 新增匹配层
- `src/lib/ratings-resolver.ts`
  - 接入 IMDb provider
- [src/app/play/page.tsx](/Users/jay/Code/LunaTV/src/app/play/page.tsx:775)
  - 详情页补 IMDb 展示

目标：

- 搜索页和播放页同时支持 `豆瓣 + IMDb`

### P2：接入 Rotten Tomatoes

- `src/lib/rt-rating.ts`
  - 新增 RT provider
- `src/lib/ratings-resolver.ts`
  - 接入 RT provider
- [src/components/VideoCard.tsx](/Users/jay/Code/LunaTV/src/components/VideoCard.tsx:1)
  - 列表页支持 `RT xx%`
- [src/app/play/page.tsx](/Users/jay/Code/LunaTV/src/app/play/page.tsx:775)
  - 详情页展示 `Tomatometer`
- [README.md](/Users/jay/Code/LunaTV/README.md:1)
  - 补环境变量和部署说明

目标：

- 搜索页与详情页完整展示三源评分

### P3：质量和维护工具

- 手工绑定 `douban_id -> imdb_id -> rt_slug`
- 异常匹配回收列表
- provider 命中率与缓存命中率统计
- 同步脚本与测试用例

## 推荐实施顺序

1. 先把统一模型和统一接口做出来，只挂豆瓣
2. 搜索页切到统一接口，确认功能等价
3. 再接 IMDb
4. 再接 RT
5. 最后补人工修正、管理开关和说明文档

## 风险点

### 1. 同名误匹配

缓解方式：

- 强依赖年份和类型
- 引入置信度
- 保留 override 机制

### 2. RT 语义与 10 分制不一致

缓解方式：

- UI 使用 `RT xx%`
- 文案明确 `Tomatometer`

### 3. 授权和接入方式不一致

缓解方式：

- provider 层抽象统一接口
- 运行时不写死具体调用方式

### 4. 搜索结果抖动

缓解方式：

- 搜索结果和评分分开刷新
- 评分异步补齐，不重排卡片主结构

## 验收标准

满足以下条件视为方案落地成功：

1. 搜索结果页能稳定展示 `豆瓣 + IMDb + RT`
2. 播放详情页能展示三源评分
3. 搜索主链路耗时没有明显恶化
4. provider 异常时页面仍可正常使用
5. 评分缺失时 UI 正常降级
6. 评分缓存和用户数据存储职责清晰分离

## 不在第一阶段做的事

- 不改下游资源站搜索返回结构
- 不把三源评分写回 `SearchResult`
- 不立刻做管理员手工绑定 UI
- 不立刻做完整后台数据管理面板

## 建议结论

最稳妥的落地方式是：

- 先统一评分聚合层
- 再逐步接入 IMDb 和 RT
- 列表页展示精简评分
- 详情页展示完整评分信息

这样可以最大程度复用现有搜索页的异步补分模式，同时把后续维护成本控制在可接受范围内。
