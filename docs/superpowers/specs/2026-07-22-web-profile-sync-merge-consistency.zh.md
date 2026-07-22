# Web 资料合并一致性规格

## 目标

将 `POST /api/admin/profile-sync/merge` 从“读出后逐项删除/写入”改为带版本控制的原子提交。一次成功响应必须代表已持久化的最终状态，不能被并发的网页写入或另一台桌面端合并覆盖。

## 已确认现状

- `luna` 分支的路由读取五个资料域，随后逐域执行删除和写入，只返回 `summary`。
- 当前桌面分支虽然支持 `domains`、`requestId` 和管理设置快照，但仍按多个独立存储命令写入。
- `BaseRedisStorage`、`KvrocksStorage`、`UpstashRedisStorage` 的常规资料写入也都是独立命令；不存在资料版本、比较并交换（CAS）或事务提交。

因此任意并发写入可在读取与替换之间丢失，且某一后端错误可留下只更新部分域的状态。

## 数据与版本模型

- 每个用户增加 Redis 字符串键 `u:${username}:profile-sync-revision`；缺失值等价于字符串 `"0"`。
- 版本永远以十进制字符串在 TypeScript、HTTP JSON 与 Rust 之间传递，禁止转为 JavaScript `number`。
- 一次成功的、会改变资料的普通写入或资料合并，均在同一原子脚本内递增该用户版本一次。
- `revision` 描述该用户五个资料域的整体版本，不为每个域分别建版本。
- `mergedSnapshot` 始终采用 `DesktopProfileSnapshot` 的完整形状；未选择的域为 `{}` 或 `[]`，与现有 `mergeDesktopProfileSnapshot` 约定一致。

## 原子提交契约

在 `IStorage` 与 `DbManager` 增加以下服务端契约（具体 DTO 放在不依赖路由的 `src/lib/profile-sync/merge-storage.ts`）：

```ts
interface ProfileSyncCommitRequest {
  username: string;
  expectedRevision: string;
  domains: readonly DesktopProfileDomain[];
  mergedSnapshot: DesktopProfileSnapshot;
  adminSettings?: ProfileSyncAdminSettingsCommit;
}

interface ProfileSyncCommitResult {
  revision: string;
}

getProfileSyncRevision(username: string): Promise<string>;
getAdminSettingsRevision(): Promise<string>;
commitProfileSyncMerge(
  request: ProfileSyncCommitRequest
): Promise<ProfileSyncCommitResult | null>;
```

`ProfileSyncAdminSettingsCommit` 必须携带 `expectedRevision: string` 与完整、已校验的 `config: AdminConfig`。路由仅从请求接收允许同步的管理设置字段，先将其合并到当前完整配置并执行 `configSelfCheck`，再把完整 `AdminConfig` 交给存储；存储不得把局部同步快照直接覆盖到 `admin:config`。

`null` 表示版本不匹配，且脚本不得写入任何键。成功时一个 Lua `EVAL` 必须：比较资料版本、完整替换被选资料域、可选地比较并提交完整管理配置、递增资料与管理设置版本，并返回新资料版本。一次调用不可分解为多个 `DEL/HSET/LPUSH/SET` 命令。

普通资料写入也必须经统一的存储内部 mutation helper 完成：`set/delete/deleteAll` 播放记录、收藏、追更、跳过配置，及搜索历史的新增/删除/清空。该 helper 在实际 mutation 与版本递增间不允许出现观察到的中间状态。无效操作可不递增版本；实现必须明确并测试其语义。

## 稳定读取与 CAS 重试

路由最多尝试 5 次：

1. 读取资料版本 A。
2. 读取所选远端资料域；如包含管理设置，同时读取其配置与管理设置版本。
3. 再读资料版本 B；A 与 B 不同则重新开始，不进行合并。
4. 使用 B 对远端快照和请求快照执行既有冲突策略，调用原子 `commitProfileSyncMerge`。
5. CAS 成功立即返回提交所用的 `mergedSnapshot` 与脚本返回的版本；CAS 失败则带短随机退避重试。

达到上限返回 `409`，不得返回伪成功、不得回传提交失败的快照。重试期间普通网页写入按其版本递增参与冲突检测，因此不会被合并的旧读结果覆盖。

## HTTP 契约

保留现有请求字段：`targetUsername`、`strategy`、`domains`、`snapshot`、`adminConfig`、`protocolVersion`、`requestId`。成功响应新增为：

```json
{
  "ok": true,
  "targetUsername": "alice",
  "strategy": "local-first",
  "revision": "42",
  "mergedSnapshot": {
    "playRecords": {},
    "favorites": {},
    "follows": {},
    "searchHistory": [],
    "skipConfigs": {}
  },
  "summary": {}
}
```

`mergedSnapshot` 是服务端成功提交的权威结果，不是客户端请求体回显。`protocolVersion` 与 `requestId` 继续原样回传，保证现有调用方兼容；新增字段只做增量扩展。

错误行为：格式错误 `400`，未认证/无权限 `401`，目标不存在 `404`，稳定读取或 CAS 耗尽 `409`，以及任意合并模式的跨槽/原子提交不可用 `409`（错误码 `PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE`）；后端不可用、脚本或缓存刷新异常 `503`。错误响应不得包含新版本或 `mergedSnapshot`。

## 管理设置

管理设置不是用户资料域，且键为全局 `admin:config`。若请求携带 `adminConfig`，必须使用独立的全局管理设置版本（`admin:config-revision`）参与同一 Lua 脚本的 CAS；脚本仅在资料版本和管理设置版本均匹配时同时写入完整 `AdminConfig` 并递增两种版本。所有常规 `saveAdminConfig` 写入也必须在同一 Lua 调用中递增管理设置版本。

脚本成功后才调用 `setCachedConfig`。缓存更新失败时必须失效/重新加载缓存并返回 `503`，绝不能把存储提交说成失败后再重试写入。单节点 Redis/Kvrocks 可执行多键 Lua 原子提交；Redis Cluster 下，本次 `EVAL` 的所有键（资料版本、每个选中资料域、以及可选的管理配置和管理版本）必须同槽。当前无 Hash Tag 的键命名不能保证该条件，因此任何收到 `CROSSSLOT` 的资料或管理设置合并都必须抛出上述错误并映射 `409`，不得退化为非原子双写。

## 验收

- 任何成功响应的 `mergedSnapshot` 可直接作为桌面端持久化快照，且对应 `revision` 已在服务器存在。
- 两个并发合并或一个合并与普通网页写入并发时，不丢失已成功的普通写入；冲突者重试或得到 `409`。
- 选中域之外绝不被读取后替换；返回中保持为空形状。
- Lua 执行失败、CAS 失败或任意模式的跨槽原子不可用时，不产生部分持久化结果，并返回规定的错误。
- Redis、Kvrocks、Upstash 三种非本地存储均实现同一契约；本地存储继续返回现有不支持错误。
