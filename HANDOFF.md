# Second Life · 完整交接文档

> 面向接手者（Codex / 其他开发者 / 未来的你）。读完本文即可无障碍继续开发。
> 后续开发路线见同目录 `NEXT_STEPS.md`。

---

## 1. 项目概述

**Second Life** 是一个以现实人生为背景的 AI 驱动型模拟游戏：玩家从 18 岁开始，经营学习、工作、社交、娱乐、运动、财富与人际关系。

- 技术栈：React 18 + TypeScript + Vite 5 + Tailwind 3 + lucide-react。无路由库、无状态库、无图表库（均为自写）。
- 当前阶段：**第一阶段完成**（完整可玩的本地版本，LocalStorage 存档）。
- 核心设计原则：**AI 只提议，程序裁决。** AI / 玩家自由输入产生的任何内容，都必须经过校验层，再由规则引擎统一结算数值。

## 2. 验证状态（务必先读）

2026-11-01：已在真实环境（Node 24 / npm 11 / Windows）完成验证，第一阶段“未验证”项已清零：

| 项目 | 状态 |
|---|---|
| `npm install`（依赖 138 包） | ✅ 通过 |
| `tsc --noEmit` 严格类型检查（含测试文件） | ✅ 通过 |
| `vitest` 单元测试（9 个文件 / 109 个用例） | ✅ 全绿，约 4s |
| `npm run sim -- 1000` 无头模拟 | ✅ 无违规，含事件覆盖率统计 |
| `vite build` 生产构建 | ✅ 通过（~290KB / gzip 106KB） |
| 浏览器逐页视觉走查 / 375px 真机 | ⚠️ **仍未做**（本次无浏览器环境，见第五阶段清单） |

**接手后的第一件事仍然是：** `npm install` → `npm test` → `npm run dev` → 浏览器逐页走一遍（重点：手机宽度、事件弹窗滚动、AI 开关、理财页）。

## 3. 快速开始

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run dev              # http://localhost:5173
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（/api 转发到 8787） |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run sim -- 1000` | 无头模拟 1000 轮，检查引擎不变量并打印结局状态 |
| `npm run server` | 启动 AI 代理（需 `DEEPSEEK_API_KEY`） |

> `.env` 不在压缩包里（含密钥风险），请从 `.env.example` 复制。

## 4. 目录结构与职责

```
second-life/
├─ index.html                 入口，加载 Google Fonts（Noto Sans/Serif SC）
├─ package.json / vite.config.ts / vitest.config.ts / tsconfig.json / tailwind.config.js / postcss.config.js
├─ .env.example               环境变量模板（前端 VITE_* + 服务端代理 + 预算）
├─ .github/workflows/ci.yml   CI：install → typecheck → test → sim 1000 → build
├─ server/proxy.mjs           AI 服务端代理（Node http，无依赖；Origin 白名单 + 限流 + 每日预算）
├─ scripts/simulate.ts        无头模拟 + 不变量断言 + 事件覆盖率（tsx 运行）
└─ src/
   ├─ main.tsx  App.tsx       渲染入口 / 路由分发（含路由守卫）
   ├─ router.ts               hash 路由 hook：/、/create、/play、/actions、/social、/archive
   ├─ store.tsx               React 状态层：持有 GameState、调用引擎、AI 编排、自动存档、toast
   ├─ index.css               Tailwind 入口 + 全局背景/滚动条/焦点样式/减少动画
   ├─ vite-env.d.ts           VITE_* 环境变量类型
   ├─ game/                   —— 纯逻辑，不依赖 React ——
   │  ├─ types.ts             全部类型（GameState v3 / NPC / Event / Effects / AIActionProposal / StoryThread / Investment …）
   │  ├─ util.ts              rng、clamp、pick、weightedPick、resolveDelta、日期（UTC）工具
   │  ├─ content.ts           常量、性格、家庭背景、行动表、职业表、成就表、理财产品表
   │  ├─ events.ts            事件模板（82 个，含事件链/季节节日/恋爱家人线）+ 筛选 isEligible + 实例化 instantiateEvent
   │  ├─ npcs.ts              9 个 NPC、互动定义、性格加成、台词模板、好感度档位
   │  ├─ engine.ts            规则引擎：状态的唯一修改入口（含 AI 增强层 + 经济系统）
   │  ├─ validate.ts          不可信输入的校验：sanitizeEffects / validateProposal / interpretFreeAction / validateEventProposal
   │  ├─ migrate.ts           存档版本迁移链 v1→v2→v3（外部存档唯一入口）
   │  ├─ finance.ts           月度收支 / 净资产 / 支出构成（纯函数）
   │  ├─ review.ts            年度回顾 / 成就进度（纯函数）
   │  ├─ life.ts              人生阶段状态机 / 人生评分（纯函数）
   │  └─ __tests__/           引擎不变量、规则、黄金快照、校验层、AI、迁移、经济、财务
   ├─ services/
   │  ├─ storage.ts           StorageAdapter 接口 + LocalStorage 实现 + Supabase 占位 + 导入导出（走 migrate）
   │  ├─ ai.ts                AI 调用层：上下文 / 事件 / 续写 / 对话 / 摘要 / 缓存
   │  ├─ aiConfig.ts          网页内 AI 配置（GET/POST/DELETE /api/ai/config，只存本机代理）
   │  ├─ aiSanitize.ts        输入降噪、内容黑名单、台词/摘要清理、标题去重（纯函数）
   │  ├─ settings.ts          本地设置（AI 开关 / 音效 / 减少动画）
   │  └─ __tests__/           AI 调用层（mock fetch）与安全过滤
   ├─ components/
   │  ├─ Layout.tsx           侧栏（桌面）/ 底栏（手机）/ 顶栏（日期、财富、行动点、AI 状态、结束今天）
   │  ├─ EventModal.tsx       全局事件弹窗：选项→检定→结果
   │  ├─ AiSettings.tsx       网页内 AI 设置弹窗（填 Key / 测试连接 / 清除配置）
   │  ├─ Toasts.tsx           通知
   │  ├─ ui.tsx               Card / Button / Chip / StatBar / Modal / DeltaChips / ResultCard / Empty
   │  └─ charts.tsx           LineChart / Radar / RelationGraph（纯 SVG）
   └─ pages/                  Home / Create / Dashboard / Actions / Social / Archive
```

## 5. 架构与数据流

```
UI 事件（点击按钮）
   │
   ▼
store.tsx  ──读取 ref.current(最新 GameState)──►  engine.xxx(state, args, rng)   ← 纯函数
   │                                                  │
   │                      ┌───────────────────────────┤
   │                      │ 不可信来源(自由输入/AI)   │
   │                      ▼                           │
   │               validate.ts 校验/夹紧              │
   │                      └──────────►  applyEffects（唯一改数值处）
   │                                                  │
   ▼◄──────────── { state: 新状态, result: ActionResult } ◄─┘
commit(newState): setState + storage.save + setLastId
setLastResult(result) → 页面里的 ResultCard / EventModal 展示
```

要点：
- 引擎内部 `structuredClone(state)` 后再改，**不原地修改入参**。失败返回**原 state 引用**，store 用 `r.state !== ref.current` 判断是否需要提交。
- `store` 用 `ref`（最新状态）而不是闭包里的 `state`，避免连点导致的过期状态。
- 所有页面只读 `useGame().state`，写操作只通过 store 暴露的方法。

## 6. 核心数据模型（`types.ts`）

`GameState`（`version: 1`）：

| 字段 | 说明 |
|---|---|
| `id / createdAt / updatedAt` | 存档标识与时间戳 |
| `startISO` | 开局日期 `2026-09-01`；当前日期 = startISO + day |
| `day` | 已过天数（从 0 起），`day+1` 为显示的"第 N 天" |
| `ap / maxAp` | 今日剩余行动点 / 上限（10） |
| `player` | 姓名、性别、性格、家庭背景、爱好、六维属性、金钱、学识 `knowledge`、职业状态 `occupation`、`jobId`、`workDays`、`birthISO` |
| `npcs[]` | 见下 |
| `pendingEvent` | 待处理事件（**必须可序列化**，存在存档中；有事件时禁止行动/结束一天） |
| `log[]` | 时间线日志（上限 700，超出优先丢最旧的 importance=1） |
| `transactions[]` | 账本（上限 700） |
| `wealthHistory[]` | 每天清晨余额快照，用于财富曲线 |
| `achievements` | `{成就id: 解锁日}` |
| `flags` | 通用标记，见下表 |
| `todayCounts` | 今日各类行动次数（用于疲劳递减、"今天已上班"） |
| `morningReport[]` | 今晨简报文字 |
| `seenEvents` | `{事件defId: 最近触发日}`（冷却/一次性） |
| `stats` | 累计收入/支出、工作天数、事件数、行动数 |

`NPC`：`id,name,age,gender,avatar(emoji),traits[],role,relation,background,affinity(-100~100),mood,status,memories[],met,lastContactDay,todayTalks?,links[],requires?`
- `memories` 上限 40，每条 `{day,text,tone}`；`links` 只用于关系图虚线。
- `requires`: `'student'`（仅学生可结识）/`'cashier'`（只能通过入职便利店自动结识）。

**`flags` 约定键**

| 键 | 含义 |
|---|---|
| `opened` | 已完成开局选择 |
| `graduated` | 已毕业 |
| `birthdayToday` | 今天是生日（次日清除，用于触发生日事件） |
| `overtimeDay` | 最近一次加班的 day（= 当前 day 表示今天已加班） |
| `loan_<npcId>` | 借款到期日（number） |
| `reach_<npcId>` | NPC 上次主动联系的 day |

**`Effects`**（引擎唯一数值入口）：`attrs / money / knowledge / ap / npc[] / flags / occupation`。`flags` 与 `occupation` 仅 `trusted` 来源（本地事件模板）可写。

**`AIActionProposal`**：`{category,title,narrative,apCost,moneyCost,effects}`，AI 与本地自由输入解析器共用该结构。

## 7. 规则引擎 API（`engine.ts`）

全部签名 `(state, ...args, rng = Math.random) => EngineResult`（`{state, result}`）。

| 函数 | 作用 |
|---|---|
| `createNewGame(input, rng)` | 新游戏；出生日期保证开局 18 岁；挂上"开局岔路口"事件 |
| `performActivity(s, id)` | 执行行动表中的行动（AP/金钱/时间条件、疲劳、爱好/性格加成、结识新人） |
| `performWork(s)` / `performOvertime(s)` | 上班（周末/一天一次限制）/ 加班（需先上班，一天一次） |
| `applyForJob(s, jobId)` | 应聘/晋升/跳槽（条件、学生只能兼职、概率） |
| `quitJob(s)` | 辞职 |
| `performFreeAction(s, text, rng, proposal?)` | 自由行动；无 proposal 时走本地关键词解析，有则（AI 提案）走同一套校验 |
| `interactWithNpc(s, npcId, kind)` | 7 种互动：chat/meal/exercise/gift/confide/help/borrow |
| `resolveEventChoice(s, choiceId)` | 事件选择：扣费→检定/加权抽取结果→结算→写日志 |
| `endDay(s)` | 当日结算、日期推进、生日/月初账单/借款到期、NPC 更新、住院判定、清晨事件 |
| 只读：`getDate / getAge / getJob / getStatusTags / buildInitialAttrs / activityBlockReason / interactionBlockReason / choiceBlockReason / lifeSummary` | UI 与校验使用 |

内部关键函数：`applyEffects`（统一结算：夹紧、边际递减、疲劳、好感递减、记账）、`maybeTrigger`（行动后概率触发事件）、`tickNpcs`、`finalize`（检查成就、更新时间戳）。

## 8. 校验层（`validate.ts`）

- `sanitizeEffects(fx, limits, state)`：只保留已知字段；属性/金钱/学识/好感夹到上限；NPC 必须存在且已结识；`flags/occupation/ap` 一律丢弃。
- `ACTION_LIMITS`：属性单项 ±4、学识 ≤24、好感 ±5、**金钱收益 0**。
- `EVENT_LIMITS`：属性 ±6、学识 ≤10、好感 ±10、金钱 +1500/-2000。
- `validateProposal`：类别白名单、AP 1–8 且不超过剩余、金钱非负且不超过余额、总正收益与耗时挂钩（`≤2.5×AP+2`）、学识 ≤3×AP。
- `interpretFreeAction`：拒绝作弊/违法/"凭空赚钱"；识别"上班"重定向到工作；解析"N 小时"（1 AP≈1.5h）与"N 元"。
- `validateEventProposal`：标题/描述长度、2–4 个选项、每选项 1–3 个结果、权重/成本/检定目标夹紧，返回 `source:'ai'` 的事件。
- `checkChance(value,target) = clamp(0.5 + (value-target)/80, 0.1, 0.95)`。

## 9. 如何扩展内容

| 想加… | 改哪里 | 注意 |
|---|---|---|
| 行动 | `content.ts` 的 `ACTIVITIES` | `effects` 里可写小数（按概率取整）；`when` 返回"不可用原因"字符串 |
| 职业 | `JOBS` | `req` 的键必须在 `REQ_LABEL` 与 `unmetRequirements` 里有对应 |
| 事件 | `events.ts` 的 `EVENT_DEFS` | 用 `o()/c()/N()` 辅助；`{npc}`、`$npc` 为占位符；`check` 时 outcomes[0]=成功、[1]=失败；`priority` 事件条件满足必触发；`once`/`cooldown` 控制重复 |
| NPC | `npcs.ts` 的 `createInitialNpcs` | 新增 NPC 要同步考虑 `requires`、`links`；老存档不会自动获得新 NPC（需迁移，见 `NEXT_STEPS.md`） |
| 互动 | `INTERACTIONS` + `KIND_TRAIT_BONUS` + `HELP_BY_RELATION` | 同时更新 `InteractionKind` 类型与 `KIND_MEMORY`（engine） |
| 成就 | `ACHIEVEMENTS` | `check` 是纯函数；解锁会写 importance=3 日志并弹 toast |
| 性格/家庭 | `PERSONALITIES / BACKGROUNDS` | 类型 `PersonalityKey / BackgroundKey` 同步 |

## 10. 数值与平衡参数

| 参数 | 值 | 位置 |
|---|---|---|
| 每日行动点 | 10 | `MAX_AP` |
| 日常开销 | ¥45/天 | `LIVING_COST` |
| 技能成长系数 | 0.45 | `SKILL_GROWTH` |
| 技能边际递减 | `clamp(((100-cur)/60)^3, 0.02, 1.3)` | `softcap`（engine） |
| 幸福/健康递减 | `clamp((100-cur)/50, 0.15, 1.2)` | 同上 |
| 同类行动疲劳 | 当日第 3 次起正收益 ×0.6 | `performActivity` |
| 好感增益递减 | `clamp((100-aff)/80, 0.08, 0.9)` | `applyEffects` |
| 同日重复找同一人 | 第 2 次 ×0.5，第 3 次起 ×0.2 | `interactWithNpc`（`todayTalks`） |
| 缺乏锻炼 | 当日无运动，体能 -0.3 | `endDay` |
| 睡眠恢复 | 健康 `0.15+剩余AP×0.12`，幸福 `剩余AP×0.08` | `endDay` |
| 负债 | 每天幸福 -2 | `endDay` |
| 住院 | 健康 ≤5：-¥1500，健康回 30，次日只剩一半 AP | `endDay` |
| 月津贴（学生） | 普通1800/富裕4500/书香2200/农村1500/单亲1600/创业3000 | `BACKGROUNDS` |
| 启动资金 | 6000/30000/10000/2500/3500/15000 | `BACKGROUNDS` |
| 月租（非学生） | 待业 ¥800 / 全职 ¥1500 | `endDay` |
| 工资/次 | 店员130、家教220、助理300、专员480、主管760、经理1200 | `JOBS` |
| 借款 | ¥500，30 天后自动归还 | `interactWithNpc/endDay` |
| 事件概率 | 行动后 12%（工作 18%，自由行动 10%，NPC 互动 10%）；清晨 40% | `maybeTrigger / endDay` |
| NPC 主动联系 | 好感≥25、≥6 天没联系、每天 15%、同日仅一人、冷却 8 天 | `tickNpcs` |
| 好感自然衰减 | 非家人、>14 天未联系、每 7 天 -1 | `tickNpcs` |

调参流程：改常量 → `npm run sim -- 1500` → 看属性/财富/好感分布。高强度（每天近乎满 AP）的随机玩家约 3 年到 85 左右为目标。

## 11. 存档与存储

- LocalStorage 键：`secondlife:index:v1`（存档元信息列表）、`secondlife:save:<id>`（完整状态）、`secondlife:last`（最近游玩）。
- 每次状态变化都整档写入（约 150–200KB）。
- `parseSave` 负责校验与向后兼容补字段；导入文件会生成新 id，避免覆盖。
- `StorageAdapter` 全部 async，切换 Supabase 只需实现 `SupabaseAdapter` 并设置 `VITE_STORAGE=supabase`。

## 12. AI 现状（第二阶段已完成）

- **运行时开关**：`services/settings.ts` 存 localStorage（键 `secondlife:settings:v1`），默认跟随 `VITE_AI_ENABLED`；首页有开关、顶栏有状态徽标（开启 / 关闭 / 冷却中 / 额度用尽）。
- **调用层**（`services/ai.ts`）：
  - `chatJSON`：超时中断（事件 25s / 对话 15s / 摘要 20s），**只在网络异常时重试 1 次**；4xx/5xx/乱码不重试；JSON 解析容忍 ```json 包裹。
  - `buildAIContext`：短而准——玩家状态 + 最近 6 条重要日志 + 最多 4 个最相关 NPC（含 `summary` 与最近 3 条记忆）+ 最近 3 条开放剧情线；**不含存档 id**。
  - `aiInterpretAction`：返回 `proposal | reject(原因) | unavailable`，拒绝原因会展示给玩家。
  - `aiGenerateEvent` / `aiContinueThread`：过 `validateEventProposal` + 内容黑名单 + 标题相似度去重（近 10 条）。
  - `aiNpcDialogue`：台词 ≤60 字、去引号换行、拒绝数值断言、同 (npc, 情境, 日期) 走缓存。
  - `aiSummarizeMemories`：记忆 ≥30 条时把最早 20 条压缩成 ≤200 字摘要。
- **引擎配合**（`engine.ts`）：`injectEvent`（乐观并发：day 必须一致、无待处理事件、至少一个可负担选项）、`rewriteNpcLine`（只改文案与记忆，不动数值）、`applyNpcSummary`、`closeStoryThread`、`recordAiCall`（成功才计入每日预算，连续 3 次失败 → 5 分钟熔断）、`canCallAi` / `aiCallsToday` / `aiCooldownLeft`。
- **触发点**（`store.tsx`）：`endDay` 后有 25% 概率生成 AI 清晨事件（若有 7–20 天未推进的剧情线则 50% 优先续写下一幕）；`npcInteract` 后替换模板台词；自由行动先请求提案、不合规时把具体原因告诉玩家再回退本地解析。
- **代理加固**（`server/proxy.mjs`）：Origin 白名单（`ALLOWED_ORIGIN`）、每 IP 30 次/分钟、每日全局预算（`DAILY_CALL_BUDGET` / `DAILY_TOKEN_BUDGET`，超限 503）、上游 30s 超时、非 200 统一 `{error}` 不透传上游、日志只记状态码与耗时、请求体 ≤64KB、只转发 messages/temperature。
- API Key 只在服务端 `process.env.DEEPSEEK_API_KEY`；前端包中不含任何密钥。`.env.example` 已补齐新变量。
- **网页内配置（新增，推荐）**：首页「AI 设置」弹窗可直接填 Key 与模型，`POST /api/ai/config` 保存到项目根目录 `.ai-config.json`（已 gitignore），代理启动时自动载入；`GET` 只回显掩码 `keyHint`，`DELETE` 清除后回落到 `.env`。优先级：网页配置 > `.env` > 系统环境变量。对应前端 `services/aiConfig.ts`（有 mock fetch 单测）与组件 `components/AiSettings.tsx`；「测试连接」会发一次约几十 token 的真实请求，用于验证 key 与网络。

## 12.1 经济系统（第三阶段已完成基础版）

- 数据：`player.savings`、`player.investments[]`（fund/index/high）、`player.credit`、`player.bankLoan`、`player.assets[]`。
- 引擎：`deposit` / `withdraw` / `buyInvestment` / `sellInvestment`（单笔 ¥100 起，上限 ¥500,000）；每月初 `settleEconomy` 自动计息（年化 2%）与理财月结（按产品 `meanRate ± vol` 波动，结果写进今晨简报与日志）。
- 统计：`game/finance.ts` 的 `monthlyStatement` / `netWorth` / `expenseBreakdown`（纯函数，有单测）。
- UI：行动页新增「理财」标签（资金概览、存入/取出、产品买入、持仓卖出）；档案页财富标签新增净资产与月度收支表。
- 成就：`savings_50k`、`first_invest`、`invest_profit`（卖出累计盈利 ¥1,000）。

## 13. UI 说明

- 风格：深色 RPG。色板 `ink`（底）/ `lantern`（金，强调）/ `rune`（紫，次要）/ `jade`（绿，收益）/ `rose2`（红，风险）。标题用 Noto Serif SC，正文 Noto Sans SC。
- 响应式：≥1024px 左侧栏；<1024px 底部 4 栏导航；顶栏常驻（日期/财富/行动点/结束今天）。
- 动效克制：事件弹窗弹出、结果卡上浮、属性条与雷达图过渡、首页两个漂浮光斑；`prefers-reduced-motion` 下全部关闭。
- 图表均为手写 SVG：`LineChart`（财富）、`Radar`（六维）、`RelationGraph`（关系网，点击节点跳转人物详情）。
- 路由守卫：游戏页无存档时自动回首页；刷新停留在当前 hash 页。

## 14. 第一阶段已实现功能清单

- 首页：游戏介绍、开始新人生、存档列表（继续/删除/导出）、导入存档。
- 角色创建：姓名（随机取名）、性别、6 种性格、6 种家庭背景、10 个爱好（≤3）、12 点属性分配（每项 ≤+8），右侧实时雷达预览与启动资金。
- 人生主界面：日期年龄、状态标签、行动点、六维属性、财富（近 30 天收支、曲线）、雷达图、今晨简报、最新事件。
- 行动：学习/工作/运动/社交/娱乐/休息 19 种行动；工作页含当前工作（上班/加班/辞职）与 6 个职位；自由行动输入框（含示例、校验提示）。
- 社交：9 个 NPC（4 个初始已识，其余通过社交发现），资料、好感档位、心情、状态、7 种互动、记忆与互动记录、关系网图。
- 档案：时间线（可筛重要事件）、财富（统计、曲线、支出构成、最近收支）、16 项成就、人生总结与称号、导出存档。
- 系统：行动点与时间推进、生日、月初津贴/房租、借款、住院、25 个事件（含属性检定与重大人生事件）、自动存档、刷新不丢进度。

## 15. 已知问题与技术债

1. ~~真实环境构建/视觉未验证~~ → 构建与测试已验证；**浏览器视觉走查仍未做**（见第 2 节）。
2. 每次操作整档写入 LocalStorage（~175KB），高频点击时有写放大；可加 debounce 或增量存储。
3. 事件模板 **82 个**（含事件链、季节/节日、恋爱/家人线）；`npm run sim` 已输出覆盖率：最近一次 1200 轮模拟覆盖 75/82，**随机事件 100% 触发**，未触发的 7 个均为条件/链式事件（毕业、重病、恋爱纪念/分手、想辞职、元旦、情人节）。
4. NPC 互动好感度在模拟中仍偏高（机器人每天狂聊所致），真人可玩性待评估。
5. ~~老存档不会获得新增 NPC/新字段~~ → 已有 `migrate.ts` 版本链（v1→v2→v3），老存档自动补齐字段；**新增 NPC 仍需手工迁移**。
6. ~~无单元测试框架~~ → 已接入 vitest（9 文件 / 109 用例）+ GitHub Actions CI。
7. ~~毕业后玩法深度不足、无结局~~ → 已加入人生阶段状态机（60 岁终局）与六维人生评分；长线目标仍有空间（阶段专属事件、创业线、轮回继承未做）。
8. 自由行动本地解析器是关键词匹配；AI 开启后才会真正“理解”任意输入，且默认关闭。
9. `Home` 页的存档列表在 `state.updatedAt` 变化时刷新；多标签页同时游玩未做 `storage` 事件互斥。
10. 无 i18n 抽象，文案硬编码为简体中文。
11. ~~信用分尚未参与规则~~ → 已实装银行贷款（额度 `(信用分-500)×60`、利率 6%~18%、12 期等额还款、逾期扣信用分、按时还清/提前结清加分）；房租押金仍未用信用分。
12. ~~资产/居住/税尚未实现~~ → 资产（5 件）、居住（3 种 + 舒适度）、税与五险一金（税前/税后拆分 + 累计计税）均已实装；第三阶段 3.1 全部完成。
13. AI 成本：目前只有「每游戏日 3 次 + 连败熔断 + 代理每日预算」，无 token 级前端预估。
14. 剧情线目前只在「重大事件 / AI 事件」结算时追加事实，尚未与 NPC 关系阶段联动。
15. 职业：绩效评估只看「本月工作天数」（加班已计入绩效），没有面试小游戏；创业线未实现。
16. 关系：NPC 之间 `links` 仍只用于展示、无数值演化；NPC 无自主人生（考研/搬家/恋爱）；家人线事件较少。
17. 事件总数 **82**（已达成 3.4 的 80+ 目标）；仍有 7 个条件/链式事件在短模拟中不触发（属正常，需要特定剧本条件）。后续可继续补充事件链的后续幕与更多节日。

## 16. 开发约定与禁忌

- ❌ 不要在 `engine.ts` 之外修改 `GameState`；❌ 不要绕过 `applyEffects` 改数值。
- ❌ 不要让 AI 返回的内容直接进入引擎，必须先过 `validate.ts`。
- ❌ 不要在前端放 API Key；❌ 不要在前端包含 `DEEPSEEK_API_KEY`。
- ❌ 事件实例里不要放函数（要能 JSON 序列化）。
- ✅ 引擎函数保持纯：新增逻辑先写进 `engine.ts` + 在 `simulate.ts` 里加断言。
- ✅ 改 `GameState` 结构时：升级 `version` 并写迁移。
- ✅ 新增 UI 文案保持简体中文、动词明确、错误信息说清原因与解决办法。
- Tailwind：只用核心类 + `tailwind.config.js` 中的自定义色；避免动态拼接类名（会被 purge 掉）。

## 17. 环境变量

| 变量 | 端 | 说明 |
|---|---|---|
| `VITE_AI_ENABLED` | 前端 | `true` 时 AI 开关默认打开（仍可在首页关闭） |
| `VITE_STORAGE` | 前端 | `local`（默认）/ `supabase` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 前端 | 第四阶段；anon key 本就公开，安全靠 RLS |
| `DEEPSEEK_API_KEY` | **服务端** | 仅 `server/proxy.mjs` 读取 |
| `DEEPSEEK_MODEL` | 服务端 | 默认 `deepseek-chat` |
| `PORT` | 服务端 | 默认 8787 |
| `ALLOWED_ORIGIN` | 服务端 | 额外允许的跨域来源（逗号分隔；localhost:5173/4173 默认已允许） |
| `DAILY_CALL_BUDGET` | 服务端 | 每日全局调用上限，默认 500；超限返回 503 |
| `DAILY_TOKEN_BUDGET` | 服务端 | 每日估算 token 上限，默认 300000 |
| `UPSTREAM_TIMEOUT_MS` | 服务端 | 上游超时，默认 30000 |

## 18. 调试技巧

- 浏览器控制台：`JSON.parse(localStorage.getItem('secondlife:save:<id>'))` 查看存档；删除 `secondlife:*` 键可重置（会清掉 AI 开关设置）。
- 想快速测试某事件：临时在 `createNewGame` 末尾 `s.pendingEvent = instantiateEvent(EVENT_BY_ID['xxx'], s, rng)`。
- 想快速测试后期内容：在 `simulate.ts` 里跑更长天数，或在控制台改存档 `day`/`player.knowledge` 后导入。
- 所有随机均可注入 `rng`，`simulate.ts` 用固定种子可复现问题。
- 测 AI：`npm run server` + 首页打开开关；故意写错 key / 断开网络，确认顶栏变为「AI 冷却中」或继续静默回落，游戏不卡住。
- 测迁移：把旧存档 JSON 的 `version` 改成 1 或 2 再导入，字段应被自动补齐。

## 19. 2026-11-01 进度记录（本次交接新增）

### 已完成
- **第 0 步**：真实 `npm install`、严格类型检查、`vitest`（109 用例）、`vite build`、`npm run sim` 全部通过；新增 `.github/workflows/ci.yml`（install → typecheck → test → sim 1000 → build）。
- **迁移框架**：`game/migrate.ts`，`CURRENT_VERSION = 10`，v1→v2（剧情线/AI 状态/NPC 摘要）、v2→v3（储蓄/理财/信用分）、v3→v4（技能/行业资历/绩效）、v4→v5（NPC 信任/关系阶段/恋爱标记）、v5→v6（银行贷款）、v6→v7（资产）、v7→v8（属性周快照）、v8→v9（居住方式）、v9→v10（本月工资明细）；`parseSave` 全走迁移链；未来版本拒绝读取；坏数据清洗。
- **第二阶段（AI 剧情引擎）**：`injectEvent` / `rewriteNpcLine` / `applyNpcSummary` / `closeStoryThread` / `recordAiCall` / `canCallAi` / `aiCallsToday` / `aiCooldownLeft`；`services/ai.ts` 全量重写（超时/重试/缓存/上下文/续写/摘要）；`services/aiSanitize.ts`（注入降噪/黑名单/去重）；`services/settings.ts`；`store.tsx` 编排清晨事件与 NPC 台词替换；顶栏 AI 状态徽标 + 首页开关；档案页「剧情线」标签；`server/proxy.mjs` 加固；`.env.example` 更新。
- **第三阶段（经济基础版）**：储蓄存取 + 月息、3 种理财产品买入/卖出 + 月度波动结算、净资产与月度收支表、3 个新成就；`game/finance.ts` 纯函数统计。
- **第三阶段（人生阶段与结局，3.6）**：`game/life.ts` 纯函数——`lifeStageFor(age)` 五阶段状态机（求学 18–22 / 立业 23–29 / 成家 30–44 / 收获 45–59 / 退休 60+），跨阶段时晨报播报 + importance=3 日志；`lifeScore(s)` 六维人生评分（健康 20 / 能力 20 / 学识技能 15 / 事业 15 / 财富 15 / 关系 15，含称号）；60 岁触发 `flags.lifeEnded`，首页弹出终局评分弹窗（可关闭，`dismissLifeEnd`），档案「人生总结」常驻当前评分卡。
- **第四阶段（Supabase 云存档，基础版）**：`services/cloudSync.ts` 本地优先同步器（节流 5s、冲突判定、失败重试、首次双向补齐）；`services/supabase.ts` 动态加载 supabase-js、魔链登录、`SupabaseStorage`（saves/profiles 表）；`services/storage.ts` 改为「委托存储」——本地为主，登录后挂远端；首页新增「云端同步」卡片（邮箱登录/状态/立即同步/退出）；`supabase/schema.sql` 提供 saves + profiles 表与 RLS 策略。未配置 `VITE_SUPABASE_*` 时全部降级为本地，不影响单机玩法。
- **第五阶段（进行中：可访问性 + 性能 + 设置页 + 引导 + 部署）**：`ui.tsx` 的 Modal 增加焦点陷阱（Tab/Shift+Tab 循环）、Esc 关闭（仅可关闭弹窗）、打开时聚焦首个可交互元素、关闭后还原焦点；路由级代码分割（`React.lazy` + `Suspense`）——Dashboard/Actions/Social/Archive 拆成独立 chunk；新增 `/settings` 设置页（AI 开关、减少动画、音效偏好占位、导出全部存档、导入、清除本机数据、关于与 AI 隐私说明、重播新手引导、版本号），首页与顶栏均有入口；新增 4 步新手引导（`components/Onboarding.tsx`，看完记 localStorage，可重播）；PWA 基础（`public/manifest.webmanifest` + `icon.svg` + index.html 元信息，支持添加到主屏幕，离线缓存未做）；部署文档 `deploy/README.md`（静态托管 / Serverless 代理 / 独立 Node 代理 / Supabase / 发布检查清单）。
- **第三阶段（税与五险一金，3.1.7）**：`game/tax.ts` 纯函数（五险一金 17.5%、月度个税税率表、累计计税）；上班/加班工资先算税前 → 五险一金 → 个税 → 到手，兼职不缴五险一金但仍计税；每月初在晨报输出「上月工资明细」并清零累计；工作页显示本月工资明细；存档 v10。
- **第三阶段（居住，3.1.6）**：`player.housing`（null = 住家里/宿舍，免费舒适度 50；合租 ¥900 舒适度 62；整租 ¥1,600 舒适度 82）；`changeHousing` 搬家一次性押金/搬家费（首月房租一半，搬回家 ¥200）；每月初按居住自动扣房租；`sleepRecovery` 把舒适度折算成睡眠恢复倍率（0.7~1.4，健康与幸福感都受影响）；理财页「居住」卡片；开局选「直接进入社会/先出去走走」默认开始合租（保持原有经济压力）；新增 2 个成就。
- **第三阶段（信用分贷款，3.1.4）**：`takeBankLoan` / `repayBankLoan` / `loanLimit` / `bankLoanRate`；可贷额度由信用分决定（`(信用分-500)×60`，上限 ¥30,000），年利率 6%~18%；每月初自动等额还款，现金不足视为逾期（信用分 -15），按时还款 +1、朋友借款按时归还 +2、结清 +25；理财页新增「银行贷款」卡片（额度/利率/月供/提前还款）。
- **第三阶段（资产，3.1.5）**：`ASSETS` 5 件（笔记本 ¥4,500 / 手机 ¥2,200 / 自行车 ¥900 / 吉他 ¥1,500 / 相机 ¥3,200），`buyAsset` 购买后提供长期加成——学习学识 +15%、编程技能 +25%、社交好感 +10%、运动体能/健康 +20%、娱乐幸福 +1；理财页新增「资产」卡片；新增 2 个成就。
- **第三阶段（档案深化，3.5 完成）**：`game/review.ts` 纯函数（年度回顾、成就进度）；时间线按年份分组 + 类别筛选（全部/事件/社交/工作/财务）；「年度回顾」标签（每年收支、结余、天数、解锁成就、5 个关键瞬间）；**属性变化标签**（`attrHistory` 每周快照，六维小图 + 首尾差值，上限 220 条）；成就扩到 **41 个**并带分类标签与进度条；**跨年自动弹出年度回顾**（`flags.pendingReviewYear` + `dismissYearReview`，Dashboard 弹窗）。
- **网页内 AI 配置**：`services/aiConfig.ts` + `components/AiSettings.tsx`，配合代理新增的 `GET/POST/DELETE /api/ai/config`；配置保存到 `.ai-config.json`（gitignore），优先级 网页 > `.env`；只回显掩码，「测试连接」走真实小请求。
- **第三阶段（职业系统）**：5 条职业线 / 17 个职位（`track`），4 项职业技能由学习与上班成长；`player.trackDays` 行业资历让转行必须从初级做起（转行惩罚）；每月初绩效评估（奖金、连续两月 ≥85 自动晋升、PIP、连续三月 ≤30 裁员）；`careerStatus` 供工作页展示职业线/绩效条/技能/下一目标；新增 6 个职业成就。
- **第三阶段（关系阶段机 + 恋爱线）**：NPC 新增 `trust` 与 `stage`（好感阈值推导，读档时重算）；互动按结果增减信任、阶段变化写日志；`confess` 表白（好感 ≥50、成功率含魅力与信任），成功建立恋人关系（`flags.partner_<id>`），好感跌破 15 自动分手；社交页展示阶段、信任条、恋人状态与表白入口。测试总计 135 用例。
- **第三阶段（事件扩充，3.4）**：事件模板 27 → **82**，覆盖日常/社交/学习/工作/随机/重大六类；新增事件链（导师推荐、奖学金回音、反诈回访，靠 `seenEvents` 做前置条件）、季节/节日事件（元旦、春节、中秋、情人节、高温、初雪）、恋爱线事件（暗示、纪念日、分手谈话）与家人健康事件。新增 `events.test.ts` 结构约定测试（唯一 id、选项/结果数量、检定两结果、**每个事件至少一个免费选项**、数值不超过引擎硬上限、占位符替换、可序列化、事件链与季节条件）。测试总计 **143** 用例。
- **顺手修掉的 Bug**：负债时 `guard` 把「需要 ¥0」当作钱不够，导致负债玩家无法做任何免费行动（已修复 + 回归测试）；v2 存档超量剧情线不被裁剪；失败调用也占用 AI 每日预算；`simulate.ts` 的「可用行动示例 undefined」与事件覆盖率缺失。

### 下一步（按优先级）
1. **浏览器视觉走查**（唯一未验证项）：`npm run dev`，重点手机 375px、AI 开关状态、理财页、剧情线标签、事件弹窗滚动。
2. 第三阶段剩余：职业技能树/绩效/裁员（3.2）、关系阶段机与恋爱线（3.3）、信用分参与贷款与房租（3.1.4）、资产与居住（3.1.5–3.1.6）、税与五险一金（3.1.7）。
3. 事件扩充到 80+ 并用 `sim` 覆盖率报告挑出永不触发的模板（当前 23/27）。
4. 人生阶段/结局与年度回顾（3.6）。
5. 第四阶段 Supabase（迁移框架已就绪）。
6. 第五阶段 UI/可访问性/部署清单。
