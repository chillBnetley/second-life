# 部署说明（第五阶段）

项目已内置三种部署形态：**Vercel（推荐，含 Serverless AI）**、**单容器 Docker（静态 + AI 代理）**、**Netlify（纯静态）**。

## 0. 最快：Vercel（前端 + AI 一体化）

```bash
npm i -g vercel
vercel login
vercel            # 预览部署
vercel --prod     # 正式上线
```
- `vercel.json` 已配置：`npm run build` → `dist`，hash 路由无需 rewrite
- `api/ai/chat.js` 是 Serverless 版 AI 代理（与 `server/proxy.mjs` 同规则）
- 在 Vercel 项目 Settings → Environment Variables 里加 `DEEPSEEK_API_KEY`（仅此一处，**不要** `VITE_` 前缀）
- 可选：`ALLOWED_ORIGIN=https://你的域名`、`DAILY_CALL_BUDGET`、`DAILY_TOKEN_BUDGET`
- 想用云端存档再加 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_STORAGE=supabase`（这是构建期变量，改完要重新部署）

## 0.1 单容器 Docker（自建 VPS / Render / Fly.io）

```bash
npm run build
docker build -t second-life --build-arg VITE_AI_ENABLED=true .
docker run -d -p 8080:8080 -p 8787:8787 -e DEEPSEEK_API_KEY=sk-xxx second-life
# 访问 http://服务器:8080
```
- 容器里同时跑 `server/proxy.mjs`（AI，8787）与 `server/prod.mjs`（静态 + /api 反代，8080）
- 不传 `DEEPSEEK_API_KEY` 也能跑，AI 自动降级

## 0.2 本地生产预览（不改任何配置）

```bash
npm run build
npm run prod      # http://localhost:8080，/api 反代到 8787
```

## 1. 前端（静态托管）

```bash
npm ci
npm run build     # 产物在 dist/
```

- 部署目录：`dist/`
- 使用 hash 路由（`/#/play`），**不需要**服务器 rewrite 规则，任意静态托管都可直接跑。
- 环境变量在**构建时**注入：`VITE_AI_ENABLED`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_STORAGE`。不要把任何密钥写成 `VITE_*`（会被打进前端包）。

推荐平台：Vercel / Netlify / Cloudflare Pages。以 Vercel 为例：Build Command `npm run build`，Output Directory `dist`。

## 2. AI 代理（二选一）

### A. Serverless（推荐）

把 `server/proxy.mjs` 的逻辑搬到平台函数（Vercel `api/ai/chat.ts` / Netlify Function / Cloudflare Worker），路径保持 `/api/ai/chat`：

- `DEEPSEEK_API_KEY` 放平台环境变量（**不要**放前端）
- 保留：Origin 白名单、每 IP 限流、每日预算、超时、统一错误体
- 函数版与前端同域，可不配 CORS

### B. 独立 Node 服务

```bash
npm run server   # 端口 8787
```

- 容器部署到 Fly.io / Render / VPS，前面加 Nginx/Caddy 反代，把 `/api` 转发到 8787
- 配置 `ALLOWED_ORIGIN=<你的站点>`、`DAILY_CALL_BUDGET`、`DAILY_TOKEN_BUDGET`
- 前端构建时可选 `VITE_AI_ENABLED=true` 让 AI 开关默认打开

## 3. 云端存档（可选）

1. Supabase 建项目 → SQL Editor 执行 [`supabase/schema.sql`](../supabase/schema.sql)
2. Authentication → 启用 Email（魔链）
3. 前端环境变量填 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`；`VITE_STORAGE=supabase`
4. 校验 RLS：用两个账号分别登录，确认 A 读不到 B 的 `saves`

## 4. 发布前检查清单

- [ ] `npm run typecheck && npm test && npm run build` 全绿
- [ ] `npm run sim -- 1000` 无不变量违规、随机事件覆盖率 100%
- [ ] 真机走查：375px、键盘 Tab 全流程、弹窗 Esc、减少动画
- [ ] AI 降级验证：无 key / 断网 / 超时 → 游戏继续，徽标显示冷却
- [ ] 云同步：两设备交替游玩、断网重连、冲突弹窗
- [ ] 隐私说明：AI 开启时自由行动文字会发给第三方；云同步数据在你的 Supabase
- [ ] PWA：`manifest.webmanifest` 已在 `public/`；如需离线可玩再加 `vite-plugin-pwa` 缓存静态资源

## 5. PWA 现状

- 已提供 `public/manifest.webmanifest` + `public/icon.svg`，支持「添加到主屏幕」（standalone）。
- **离线缓存尚未实现**：需要 `vite-plugin-pwa` 或手写 Service Worker；游戏本身离线可用（localStorage），缺的只是静态资源缓存。
