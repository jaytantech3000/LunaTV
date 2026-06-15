# 多 Vercel 账号分布式部署设计

**日期：** 2026-06-12  
**状态：** 已实施（vcma 账号已上线）  
**背景：** 当前绑定的 Vercel 免费账号因流量超限被 Paused，需要通过多账号分散流量解决限制问题。

---

## 目标

- 一个对外域名 `luna.hkcu.qzz.io`，用户无感知后端变化
- 流量均摊到 4+ 个 Vercel 免费账号，每个账号承担约 25% 流量
- 后端入口域名 `vc*.hkcu.qzz.io` 不对外暴露，防止恶意扫描
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
Cloudflare Worker          ← 随机选后端，改写 Set-Cookie domain
 │
 ├─→ vcma.hkcu.qzz.io  →  Vercel 账号 ma（已上线）
 ├─→ vc2.hkcu.qzz.io   →  Vercel 账号 B（待添加）
 └─→ ...
                │
                ▼
         Upstash Redis（单一共享实例）
```

---

## 安全说明：无需代码改动

`src/middleware.ts` 中的 `isAllowedHost` 函数已封堵直接访问 `.vercel.app` 的请求（返回 403），只允许 `hkcu.qzz.io` 及其子域名访问。`vc*.hkcu.qzz.io` 作为子域名会被放行，但这些域名不对外暴露，安全性依赖域名不公开。

---

## 第一步：获取并迁移 Upstash 连接信息

原账号通过 Vercel Marketplace 集成 Upstash，自动注入的变量名为 `KV_REST_API_URL` / `KV_REST_API_TOKEN`（代码读取 fallback 链的第三优先级）。

**迁移到标准变量名（先加后删）：**

1. 原账号 → Environment Variables → 复制 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN` 的值
2. 添加高优先级变量：
   - `UPSTASH_REDIS_REST_URL` = 上面复制的 URL 值
   - `UPSTASH_REDIS_REST_TOKEN` = 上面复制的 Token 值
3. Redeploy 确认正常后，删除旧变量（`KV_REST_API_URL`、`KV_REST_API_TOKEN` 及其他 Marketplace 冗余变量）
4. 再次 Redeploy 确认

> 代码 fallback 链：`UPSTASH_REDIS_REST_URL` → `UPSTASH_URL` → `KV_REST_API_URL`

---

## 第二步：各 Vercel 账号部署

### 2.1 Import GitHub 仓库

1. New Project → Import Git Repository → 填入同一个 GitHub 仓库 URL（无需 fork）
2. Framework 选 **Next.js**，其余默认
3. Environment 选 **Production**

### 2.2 配置环境变量（手动添加，不通过 Marketplace）

| 变量名                     | 值                               |
| -------------------------- | -------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | 从第一步复制的值（所有账号相同） |
| `UPSTASH_REDIS_REST_TOKEN` | 从第一步复制的值（所有账号相同） |
| `NEXT_PUBLIC_STORAGE_TYPE` | 与原账号相同                     |
| `USERNAME`                 | 与原账号相同                     |
| `PASSWORD`                 | 与原账号相同                     |
| `NEXT_PUBLIC_SITE_NAME`    | 与原账号相同                     |

**Sensitive 变量无法复制时的处理方式：**

- `UPSTASH_REDIS_REST_URL/TOKEN`：去 [console.upstash.com](https://console.upstash.com) 直接复制
- `USERNAME/PASSWORD`：自己设置的凭据直接填；如忘记可用 `npx vercel env pull .env.local` 导出
- `NEXT_PUBLIC_STORAGE_TYPE`：原账号有 Upstash 变量，值即为 `upstash`
- `NEXT_PUBLIC_SITE_NAME`：打开线上网站，浏览器标签页标题即为该值

### 2.3 禁用 Cron Jobs

`/api/cron` 非幂等（并发执行会导致 Redis 写冲突），只保留一个账号触发：

- **只有原主账号**保留 Cron Jobs 启用
- 新账号：Project Settings → Cron Jobs → 全部禁用

---

## 第三步：Cloudflare DNS — 后端子域名（灰云）

在 Cloudflare → hkcu.qzz.io → DNS 添加：

| 类型  | 名称   | 目标                   | 代理状态             |
| ----- | ------ | ---------------------- | -------------------- |
| CNAME | `vcma` | `cname.vercel-dns.com` | **灰云（DNS only）** |
| CNAME | `vc2`  | `cname.vercel-dns.com` | **灰云（DNS only）** |
| ...   | ...    | ...                    | **灰云**             |

> 必须灰云，Vercel 域名验证需要直连，橙云会干扰验证。

### Vercel 自定义域名验证

每个账号 → Project Settings → Domains → Add Domain（填对应 `vc*.hkcu.qzz.io`），Vercel 给出 TXT 验证记录后在 Cloudflare 添加：

| 类型 | 名称           | 值                |
| ---- | -------------- | ----------------- |
| TXT  | `_vercel.vcma` | `vc=账号ma给的值` |
| TXT  | `_vercel.vc2`  | `vc=账号B给的值`  |

回到 Vercel 点 Verify，等待 1-5 分钟。

---

## 第四步：Cloudflare Worker 负载均衡

### Worker 代码

```javascript
const BACKENDS = [
  'https://vcma.hkcu.qzz.io',
  // 'https://vc2.hkcu.qzz.io',  // 添加更多账号时取消注释
];

export default {
  async fetch(request, env) {
    const backend = BACKENDS[Math.floor(Math.random() * BACKENDS.length)];
    const url = new URL(request.url);
    const targetUrl = backend + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', url.hostname);

    // 先 buffer body，避免 POST body 是 stream 时 redirect 无法重传
    const body = request.body ? await request.arrayBuffer() : null;

    const proxiedRequest = new Request(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'follow',
    });

    const response = await fetch(proxiedRequest);

    // 改写 Set-Cookie domain：后端 cookie 默认绑定 vc*.hkcu.qzz.io，
    // 去掉 domain 属性让浏览器自动种在公开域名 luna.hkcu.qzz.io 上
    const newResponse = new Response(response.body, response);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const fixedCookie = setCookie
        .replace(/;\s*domain=[^;]*/gi, '')
        .replace(/;\s*secure/gi, '; Secure');
      newResponse.headers.set('set-cookie', fixedCookie);
    }

    return newResponse;
  },
};
```

> **Cookie domain 说明**：Next.js 登录 API 设置 cookie 时未指定 `domain`，默认绑定请求 host（`vc*.hkcu.qzz.io`）。浏览器访问 `luna.hkcu.qzz.io` 时无法读取该 cookie，导致登录后 middleware 认为未认证、停留在登录页。Worker 通过去掉 Set-Cookie 的 domain 属性解决此问题。

### Worker 路由

Cloudflare → hkcu.qzz.io → Workers Routes：

- 路由：`luna.hkcu.qzz.io/*` → 绑定上面的 Worker

---

## 第五步：luna 公开入口 DNS（橙云）

原 `luna` CNAME 记录的目标值无需修改（Cloudflare 橙云拦截后目标不会被实际访问），只需把代理状态从灰云改为**橙云（Proxied）**。

| 类型  | 名称   | 目标           | 代理状态            |
| ----- | ------ | -------------- | ------------------- |
| CNAME | `luna` | 原有值保持不变 | **橙云（Proxied）** |

---

## 扩展性

新增账号时：

1. Cloudflare DNS 添加 `vcN` CNAME（灰云）
2. 新账号绑定域名 `vcN.hkcu.qzz.io` 并 TXT 验证
3. Worker 的 `BACKENDS` 数组添加一行
4. 禁用新账号的 Cron Jobs
