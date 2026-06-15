# 多 Vercel 账号分布式部署设计

**日期：** 2026-06-12  
**状态：** 待实施  
**背景：** 当前绑定的 Vercel 免费账号因流量超限被 Paused，需要通过多账号分散流量解决限制问题。

---

## 目标

- 一个对外域名 `luna.hkcu.qzz.io`，用户无感知后端变化
- 流量均摊到 4+ 个 Vercel 免费账号，每个账号承担约 25% 流量
- 后端入口域名 `vc1/vc2/vc3/vc4.hkcu.qzz.io` 不对外暴露，防止恶意扫描
- 所有账号共享同一个 Upstash Redis，用户数据一致

---

## 整体架构

```
用户
 │
 ▼
luna.hkcu.qzz.io          ← Cloudflare 橙云代理 + Worker 负载均衡
 │
 ▼
Cloudflare Worker          ← 随机选后端 + 注入 x-internal-token
 │
 ├─→ vc1.hkcu.qzz.io  →  Vercel 账号 A (.vercel.app)
 ├─→ vc2.hkcu.qzz.io  →  Vercel 账号 B (.vercel.app)
 ├─→ vc3.hkcu.qzz.io  →  Vercel 账号 C (.vercel.app)
 └─→ vc4.hkcu.qzz.io  →  Vercel 账号 D (.vercel.app)
                │
                ▼
         Upstash Redis（单一共享实例）
```

---

## 第一步：获取 Upstash 连接信息

所有 Vercel 账号必须共用**同一个** Upstash database，才能保证用户数据一致。

1. 登录**原 Vercel 账号** Dashboard
2. 进入当前项目 → Settings → Environment Variables
3. 找到并复制以下两个值（后续步骤要用）：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

> ⚠️ 新账号**不要**通过 Vercel Marketplace 重新集成 Upstash，否则会创建新的独立 database，数据无法共享。

---

## 第二步：各 Vercel 账号部署

每个账号执行相同操作（以账号 B/C/D 为例，账号 A 为原有账号）：

### 2.1 Import GitHub 仓库

1. 登录新 Vercel 账号
2. New Project → Import Git Repository
3. 填入同一个 GitHub 仓库 URL（无需 fork，公开仓库直接 import；私有仓库需在 GitHub 账号下授权该 Vercel 账号的 GitHub App）
4. Framework 选 **Next.js**，其余保持默认

### 2.2 配置环境变量

在 Project Settings → Environment Variables 中添加以下变量（**不要**使用 Upstash 集成按钮）：

| 变量名 | 值 |
|--------|-----|
| `UPSTASH_REDIS_REST_URL` | 从第一步复制的值 |
| `UPSTASH_REDIS_REST_TOKEN` | 从第一步复制的值 |
| `NEXT_PUBLIC_STORAGE_TYPE` | `upstash` |
| `USERNAME` | 与原账号相同 |
| `PASSWORD` | 与原账号相同 |
| `NEXT_PUBLIC_SITE_NAME` | 与原账号相同 |

### 2.3 记录 .vercel.app 域名

部署完成后，记录每个账号生成的域名，例如：
- 账号 A：`lunatv-abc123.vercel.app`
- 账号 B：`lunatv-def456.vercel.app`
- 账号 C：`lunatv-ghi789.vercel.app`
- 账号 D：`lunatv-jkl012.vercel.app`

### 2.4 处理 Cron Job（重要）

`/api/cron` 的业务逻辑**不是幂等的**（并发执行会导致 Redis 写冲突）。

**只保留一个账号的 cron 配置：**

- 账号 A（原账号）：保留 `vercel.json` 中的 cron 配置不变
- 账号 B/C/D：在 Vercel Dashboard 中关闭 Cron Jobs，或在各自的部署分支里删除 `vercel.json` 的 cron 字段

> 如果所有账号都用同一个 repo 和同一个 `vercel.json`，可以在账号 B/C/D 的 Project Settings → Cron Jobs 里手动禁用。

---

## 第三步：Cloudflare DNS 配置 — 后端子域名

为每个 Vercel 账号配置 `vc*.hkcu.qzz.io` 子域名作为内部入口（**不对外暴露**）。

### 3.1 在 Cloudflare 添加 CNAME 记录

在 Cloudflare Dashboard → hkcu.qzz.io → DNS → Records，添加 4 条记录：

| 类型 | 名称 | 目标 | 代理状态 |
|------|------|------|---------|
| CNAME | `vc1` | `cname.vercel-dns.com` | **灰云（DNS only）** |
| CNAME | `vc2` | `cname.vercel-dns.com` | **灰云（DNS only）** |
| CNAME | `vc3` | `cname.vercel-dns.com` | **灰云（DNS only）** |
| CNAME | `vc4` | `cname.vercel-dns.com` | **灰云（DNS only）** |

> ⚠️ 必须是**灰云（DNS only）**，不能开橙云代理。Vercel 自定义域名验证需要直连，橙云会干扰验证。

### 3.2 在各 Vercel 账号添加自定义域名

每个账号分别操作：

1. 进入 Project → Settings → Domains
2. 点击 Add Domain，输入对应子域名：
   - 账号 A → `vc1.hkcu.qzz.io`
   - 账号 B → `vc2.hkcu.qzz.io`
   - 账号 C → `vc3.hkcu.qzz.io`
   - 账号 D → `vc4.hkcu.qzz.io`
3. Vercel 会提示需要添加 TXT 验证记录，格式类似：
   ```
   类型: TXT
   名称: _vercel
   值: vc=xxxxxxxxxxxx（Vercel 提供的唯一值）
   ```
4. 回到 Cloudflare DNS，**为每个子域名分别**添加对应的 TXT 记录：

   | 类型 | 名称 | 值 |
   |------|------|-----|
   | TXT | `_vercel.vc1` | `vc=账号A给的值` |
   | TXT | `_vercel.vc2` | `vc=账号B给的值` |
   | TXT | `_vercel.vc3` | `vc=账号C给的值` |
   | TXT | `_vercel.vc4` | `vc=账号D给的值` |

5. 回到 Vercel Dashboard 点击 Verify，等待验证通过（通常 1-5 分钟）
6. 验证通过后，访问 `vc1.hkcu.qzz.io` 应该能正常打开项目

---

## 第四步：添加请求来源校验（安全加固）

防止直接访问 `.vercel.app` 域名或 `vc*.hkcu.qzz.io` 绕过 Worker。

### 4.1 生成 WORKER_SECRET

生成一个随机字符串（建议 32 位），例如：
```bash
openssl rand -hex 16
```

### 4.2 在所有 Vercel 账号添加环境变量

在每个账号的 Project Settings → Environment Variables 添加：

| 变量名 | 值 |
|--------|-----|
| `WORKER_SECRET` | 生成的随机字符串（所有账号相同） |

### 4.3 修改 Next.js Middleware

在 `src/middleware.ts` 中增加来源校验逻辑：直接访问后端时（缺少 `x-internal-token` header）重定向到 `luna.hkcu.qzz.io`。

> 具体代码修改见实施计划。

---

## 第五步：Cloudflare Worker 负载均衡

### 5.1 创建 Worker

在 Cloudflare Dashboard → Workers & Pages → Create → Worker：

```javascript
const BACKENDS = [
  'https://vc1.hkcu.qzz.io',
  'https://vc2.hkcu.qzz.io',
  'https://vc3.hkcu.qzz.io',
  'https://vc4.hkcu.qzz.io',
];

// 从 Worker 环境变量读取（在 Worker Settings 里配置）
const WORKER_SECRET = env.WORKER_SECRET;

export default {
  async fetch(request, env) {
    const backend = BACKENDS[Math.floor(Math.random() * BACKENDS.length)];
    const url = new URL(request.url);
    const targetUrl = backend + url.pathname + url.search;

    const proxiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'x-internal-token': env.WORKER_SECRET,  // 注入校验 header
        'x-forwarded-host': url.hostname,        // 保留原始 host
      },
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      redirect: 'follow',
    });

    return fetch(proxiedRequest);
  }
};
```

### 5.2 配置 Worker 环境变量

在 Worker → Settings → Variables and Secrets 添加：

| 变量名 | 值 | 类型 |
|--------|-----|------|
| `WORKER_SECRET` | 与第四步相同的随机字符串 | Secret |

### 5.3 配置 Worker 路由

在 Cloudflare Dashboard → hkcu.qzz.io → Workers Routes 添加：

| 路由 | Worker |
|------|--------|
| `luna.hkcu.qzz.io/*` | 上面创建的 Worker |

### 5.4 配置 luna 子域名 DNS

在 Cloudflare DNS 添加：

| 类型 | 名称 | 目标 | 代理状态 |
|------|------|------|---------|
| CNAME | `luna` | `vc1.hkcu.qzz.io`（随便指一个，Worker 会接管） | **橙云（Proxied）** |

---

## 第六步：验证

| 检查项 | 方法 |
|--------|------|
| 各后端可用 | 直接访问 `vc1.hkcu.qzz.io`，应能打开项目（此时无 Worker token，会被重定向到 `luna.hkcu.qzz.io`，说明安全校验生效） |
| 负载均衡生效 | 访问 `luna.hkcu.qzz.io`，多次刷新，在 Cloudflare Worker 控制台查看请求日志，确认流量分散到各后端 |
| 数据一致性 | 在 `luna.hkcu.qzz.io` 收藏一个视频，直接访问各 `vc*.hkcu.qzz.io`（临时关闭 middleware 校验），确认收藏数据一致 |
| Cron 只执行一次 | 检查 Vercel Dashboard，确认只有账号 A 的 Cron Jobs 处于启用状态 |

---

## 代码改动范围

仅需修改一个文件：

- **`src/middleware.ts`**：增加 `x-internal-token` 校验，缺少时重定向到 `luna.hkcu.qzz.io`

其余（`vercel.json`、环境变量）均为配置层操作，无需改动代码。

---

## 扩展性

需要新增第 5 个账号时：
1. 在 Cloudflare DNS 添加 `vc5` CNAME 记录
2. 新 Vercel 账号添加域名 `vc5.hkcu.qzz.io` 并验证
3. 在 Worker 的 `BACKENDS` 数组末尾加一行
4. 禁用新账号的 Cron Jobs
