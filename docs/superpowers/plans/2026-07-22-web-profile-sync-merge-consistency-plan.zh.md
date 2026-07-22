# Web 资料合并一致性实施计划

> **给代理执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行；步骤使用复选框跟踪。

**目标：** 为 Web 资料合并提供按用户版本的原子提交、稳定读取/CAS 重试，以及提交后的权威快照响应。

**架构：** 路由只做认证、校验、稳定读取、纯合并和重试；存储层用同一 Lua 脚本完成比较版本、替换选中域与递增版本。所有常规资料 mutation 复用存储内部原子 helper，使合并的 CAS 能观察它们。

**技术栈：** Next.js Route Handler、TypeScript、Jest、node-redis/Kvrocks、Upstash Redis、Lua EVAL。

## 全局约束

- 资料版本为十进制字符串，缺失值为 `"0"`，不得转换为 JavaScript 数字。
- 成功响应必须包含提交后的 `mergedSnapshot`、`revision` 与既有 `summary`。
- CAS 返回不匹配时不得写入；最多重试 5 次，最终返回 `409`。
- 所有普通资料写入与版本递增必须是同一原子后端操作。
- 携带 `adminConfig` 时，路由只接收允许同步字段，合并并校验为完整 `AdminConfig` 后才可原子提交；任何资料或管理设置跨槽/原子不可用均返回 `409`。
- 单节点 Redis/Kvrocks 可执行多键 Lua；Redis Cluster 只有本次全部 EVAL 键同槽才可执行，当前无 Hash Tag 键名收到 `CROSSSLOT` 时必须拒绝且不得双写回退。
- 不修改桌面 Rust；本计划只改变 Web 服务端协议与存储实现。

---

## 文件边界

- 新建：`src/lib/profile-sync/merge-storage.ts` —— 路由和后端共享的提交 DTO、版本常量与结果类型。
- 修改：`src/lib/types.ts`、`src/lib/db.ts` —— 暴露统一存储契约与 DbManager 转发。
- 修改：`src/lib/redis-base.db.ts`、`src/lib/upstash.db.ts` —— Lua 提交与普通 mutation 版本递增；`src/lib/kvrocks.db.ts` 继承 BaseRedis 实现。
- 修改：`src/app/api/admin/profile-sync/merge/route.ts` —— 稳定读、CAS 重试、响应与错误映射。
- 修改/新建测试：`src/app/api/admin/profile-sync/merge/route.test.ts`、`src/lib/profile-sync/merge-storage.test.ts`、`src/lib/redis-base.db.test.ts`、`src/lib/upstash.db.test.ts`。

### Task 1：定义契约与 DbManager 转发

**文件：**

- 新建：`src/lib/profile-sync/merge-storage.ts`
- 修改：`src/lib/types.ts`
- 修改：`src/lib/db.ts`
- 测试：`src/lib/profile-sync/merge-storage.test.ts`

**产物：** `ProfileSyncCommitRequest`、`ProfileSyncCommitResult`、`getProfileSyncRevision`、`getAdminSettingsRevision`、`commitProfileSyncMerge`，以及 `DbManager` 的同名转发。DTO 必须引用现有 `DesktopProfileDomain` 与 `DesktopProfileSnapshot`；管理设置提交必须包含预期管理版本和完整、已校验的 `AdminConfig`，不能包含局部同步快照。

- [ ] 写失败测试：DbManager 将版本读取和提交调用原样转发；提交冲突为 `null`。
- [ ] 运行：`npm test -- src/lib/profile-sync/merge-storage.test.ts`；预期因接口和方法缺失失败。
- [ ] 新建 DTO，并在 `IStorage` 添加：

```ts
getProfileSyncRevision(userName: string): Promise<string>;
getAdminSettingsRevision(): Promise<string>;
commitProfileSyncMerge(request: ProfileSyncCommitRequest): Promise<ProfileSyncCommitResult | null>;
```

- [ ] 在 `DbManager` 添加同名无转换转发；删除该文件中仅靠 `any` 探测管理配置方法的新增路径。
- [ ] 重跑测试；预期通过。
- [ ] 提交：`git add src/lib/{types,db}.ts src/lib/profile-sync/merge-storage* && git commit -m "feat(web): define profile merge commit contract"`。

### Task 2：实现 Redis/Kvrocks 原子资料版本与提交

**文件：**

- 修改：`src/lib/redis-base.db.ts`
- 测试：`src/lib/redis-base.db.test.ts`

**产物：** BaseRedis 的 `EVAL` 脚本与普通资料 mutation helper；Kvrocks 无独立写入，因为它继承该实现。

- [ ] 写失败测试：预期资料或管理设置版本不匹配返回 `null` 且不调用任何替换命令；成功提交仅一次 `eval` 并返回字符串版本。
- [ ] 写失败测试：播放/收藏/追更/跳过配置和搜索历史的每个实际 mutation 递增一次版本；无效删除语义被明确断言。
- [ ] 运行：`npm test -- src/lib/redis-base.db.test.ts`；预期失败。
- [ ] 实现 `profileRevisionKey(userName)` 与共享 `runProfileMutation`；通过 Lua 在同一脚本执行资料命令和 `INCR`。
- [ ] 实现提交 Lua：先比较 `GET revision or "0"` 与参数；选中域仅处理其 Hash/List；成功后 `INCR` 并返回版本。脚本不得调用路由层的 `splitCompositeKey`。
- [ ] 为管理设置加入第二预期版本、`admin:config-revision` 和完整 `AdminConfig` 的同脚本写入；所有普通 `setAdminConfig` 也须在同一 Lua 调用递增管理版本。任意资料或管理设置 `CROSSSLOT` 必须抛出可识别的 `PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE`，不写任何键且不双写回退。
- [ ] 重跑测试；预期通过。
- [ ] 提交：`git add src/lib/redis-base.db.ts src/lib/redis-base.db.test.ts && git commit -m "feat(web): atomically commit redis profile merges"`。

### Task 3：实现 Upstash 等价契约

**文件：**

- 修改：`src/lib/upstash.db.ts`
- 测试：`src/lib/upstash.db.test.ts`

**产物：** 与 Task 2 相同的键、Lua 参数顺序、冲突含义和 mutation 版本语义；仅适配 Upstash 的 `eval(script, keys, args)` 调用形式。

- [ ] 写失败测试：对同一请求，Upstash `eval` 接收与 BaseRedis 相同的键值集合和字符串版本；冲突返回 `null`。
- [ ] 写失败测试：每类普通 mutation 均经 `eval`，不保留独立 `hset/del/lpush` 加版本的两步实现。
- [ ] 运行：`npm test -- src/lib/upstash.db.test.ts`；预期失败。
- [ ] 复用共享脚本文本或逐字等价脚本，完成 `getProfileSyncRevision` 与 `commitProfileSyncMerge`。
- [ ] 重跑测试；预期通过。
- [ ] 提交：`git add src/lib/upstash.db.ts src/lib/upstash.db.test.ts && git commit -m "feat(web): atomically commit upstash profile merges"`。

### Task 4：改造合并路由为稳定读取与 CAS 重试

**文件：**

- 修改：`src/app/api/admin/profile-sync/merge/route.ts`
- 修改：`src/app/api/admin/profile-sync/merge/route.test.ts`

**依赖：** Task 1 的 `db.getProfileSyncRevision` 与 `db.commitProfileSyncMerge`。

- [ ] 写失败测试：成功响应包含字符串 `revision` 与完整 `mergedSnapshot`；未选择域为空形状，`requestId`/`protocolVersion` 保持回传。
- [ ] 写失败测试：第一次 CAS 返回 `null` 时，路由重新读取、重新合并并在第二次成功；五次冲突返回 `409` 且没有成功快照。
- [ ] 写失败测试：资料或管理设置的两次稳定读版本不同，不调用提交；跨槽原子不可用在任何合并模式返回 `409`；缓存只在提交成功后更新。
- [ ] 运行：`npm test -- src/app/api/admin/profile-sync/merge/route.test.ts`；预期失败。
- [ ] 删除 `replacePlayRecords`、`replaceFavorites`、`replaceFollows`、`replaceSearchHistory`、`replaceSkipConfigs` 在路由中的调用路径。实现固定 5 次循环：读版本 A、读远端、读版本 B、比较、纯合并、CAS、随机短退避。
- [ ] 将后端异常映射为 `503`；保留 `400/401/404`；CAS/稳定读取耗尽及 `PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE` 映射为 `409`。路由只接收允许同步字段，合并为完整 `AdminConfig` 后传入提交；成功后执行 `setCachedConfig`，其失败时失效或重新载入缓存并返回 `503`，不再提交一次。
- [ ] 重跑测试；预期通过。
- [ ] 提交：`git add src/app/api/admin/profile-sync/merge/route.ts src/app/api/admin/profile-sync/merge/route.test.ts && git commit -m "feat(web): return committed profile merge snapshots"`。

### Task 5：并发回归与全量验证

**文件：**

- 修改：仅补充上述测试文件；不改生产接口。

- [ ] 增加路由级竞态测试：第一次远端快照后模拟普通网页写入使版本变化，确认旧合并不覆盖该写入；重试后返回包含两方数据的权威快照。
- [ ] 增加双合并测试：两个请求从相同版本开始，其中一个成功、另一个重读重试，两个成功响应的版本不同且各自响应匹配其实际提交。
- [ ] 增加 Lua 失败测试：脚本抛错时没有 `setCachedConfig`，响应为 `503`。
- [ ] 运行：`npm test -- src/lib/profile-sync/desktop-merge.test.ts src/lib/profile-sync/merge-storage.test.ts src/lib/redis-base.db.test.ts src/lib/upstash.db.test.ts src/app/api/admin/profile-sync/merge/route.test.ts`；预期全部通过。
- [ ] 运行：`npm run lint` 与 `npm run build`；预期退出码 `0`。
- [ ] 提交：`git add src && git commit -m "test(web): cover concurrent profile merge commits"`。

## 独立写入范围

1. 代理 A：Task 1，只写 `merge-storage.ts`、`types.ts`、`db.ts` 和对应契约测试。
2. 代理 B：Task 2，只写 `redis-base.db.ts` 和其测试（Kvrocks 继承验证）。
3. 代理 C：Task 3，只写 `upstash.db.ts` 和其测试。
4. 代理 D：Task 4 与 5 的路由文件和路由测试；在 A 的契约合入后执行。

主代理负责确认 DTO 签名、完整管理配置合并、Lua 键槽前提、管理设置的全局版本语义，以及最终全量验证。
