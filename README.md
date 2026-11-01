# Second Life · AI 第二人生模拟器

[![CI](https://github.com/chillBnetley/second-life/actions/workflows/ci.yml/badge.svg)](https://github.com/chillBnetley/second-life/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

> 以现实人生为背景的 AI 模拟游戏：从 18 岁开始经营学习、工作、社交、财富与关系。
> **AI 只提议，程序裁决**——所有数值由确定性规则引擎结算，AI 无法凭空改数值。

在线体验：https://second-life-henna-three.vercel.app

React + TypeScript + Vite + Tailwind + Lucide。当前进度：第一阶段完成，第二阶段（AI 剧情引擎）与第三阶段经济基础版也已接入。

## 运行
```bash
npm install
npm test             # vitest：规则引擎不变量 / 校验层 / AI 层 / 迁移 / 经济（109 用例）
npm run typecheck    # 类型检查
npm run sim          # 无头模拟 N 天（默认 800），打印不变量断言、事件覆盖率；可传天数：npm run sim -- 1000
npm run dev          # http://localhost:5173
npm run build        # 生产构建 → dist/
```

AI（推荐在网页里配置，不用改文件）：
1. 另开终端运行 `npm run server`（AI 代理；Windows PowerShell 若提示禁止运行脚本，用 `npm.cmd run server`）。
2. 打开游戏首页 →「AI 剧情引擎」卡片 →「AI 设置（填 API Key）」→ 粘贴你的 DeepSeek API Key →「保存并使用」。
3. 也可以继续用 `.env` 配置（`DEEPSEEK_API_KEY`），网页里的配置优先；网页配置保存在项目根目录 `.ai-config.json`（已 gitignore，不会进前端包/存档）。

开启后：自由行动由 AI 理解、清晨可能生成 AI 事件、NPC 台词由 AI 重写；任何失败（无 key / 断网 / 超时 / 内容不合规 / 越界数值）都会自动回落本地剧情，游戏不会卡住。

## 云端同步（第四阶段，可选）
1. 在 Supabase 建项目 → SQL Editor 里执行 `supabase/schema.sql`（建表 + RLS）。
2. `.env` 填 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，重启开发服务器。
3. 首页「云端同步」卡片 → 填邮箱 → 发送登录链接 → 点邮件里的链接回到游戏，存档会自动双向补齐并后台同步。
本地存档始终可用；未配置 Supabase 时该卡片只显示配置说明。

## 架构要点
- `src/game/engine.ts`：纯函数规则引擎，状态的**唯一**修改入口。数值变化统一经 `applyEffects` 夹紧。
- `src/game/validate.ts`：玩家自由输入与 AI 返回的 JSON 都必须在此校验，才能进入引擎。
- `src/game/{content,events,npcs}.ts`：纯数据（行动、职业、事件模板、NPC、对话、理财产品）。
- `src/game/migrate.ts`：存档版本迁移链（v1→v2→v3），外部存档读取的唯一入口。
- `src/game/finance.ts`：月度收支 / 净资产 / 支出构成（纯函数）。
- `src/services/ai.ts` + `src/services/aiSanitize.ts` + `server/proxy.mjs`：AI 请求只走服务端代理，Key 在环境变量里；AI 输出一律是「提案」。
- `src/services/storage.ts`：`StorageAdapter` 接口 + LocalStorage 实现 + Supabase 占位。
- `src/store.tsx`：React 状态层，负责引擎调用、AI 编排（预算/熔断/过期丢弃）与自动存档。

## 测试与 CI
- `src/game/__tests__/`：不变量、规则、黄金快照、校验层、AI 增强层、迁移、经济、财务。
- `src/services/__tests__/`：AI 调用层（mock fetch）与安全过滤。
- `.github/workflows/ci.yml`：install → typecheck → test → sim 1000 → build。
