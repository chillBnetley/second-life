/**
 * 存档迁移框架：版本升级链。
 *
 * 约定：
 *  - 每次改动 `GameState` 结构，`CURRENT_VERSION + 1`，并在 `STEPS` 里追加一步 `from → to`。
 *  - 每一步都是纯函数：输入旧结构（可能缺字段），输出补齐后的结构，不改动入参对象。
 *  - `migrate()` 是外部存档（导入文件 / LocalStorage / 将来的云端）进入游戏的**唯一**入口，
 *    任何无法识别的输入都抛错，由调用方提示玩家，而不是把坏数据塞进引擎。
 */
import type { AIState, GameState, StoryThread } from './types';
import { ASSETS } from './content';
import { ROMANCEABLE_IDS, stageForAffinity } from './npcs';

export const CURRENT_VERSION = 10;

const emptyAi = (): AIState => ({ day: 0, calls: 0, failures: 0, cooldownUntil: 0 });

type Loose = Record<string, unknown>;

const isObj = (x: unknown): x is Loose => !!x && typeof x === 'object' && !Array.isArray(x);

/** 存档最低限度的形状校验：没有这些字段就不是本游戏的存档 */
function assertShape(raw: unknown): asserts raw is Loose {
  if (!isObj(raw)) throw new Error('这不是 Second Life 的存档文件（内容不是对象）。');
  const player = raw.player;
  if (!isObj(player) || !isObj(player.attrs)) throw new Error('存档缺少角色数据，无法读取。');
  if (!Array.isArray(raw.npcs)) throw new Error('存档缺少人物数据，无法读取。');
  if (typeof raw.day !== 'number' || !Number.isFinite(raw.day) || raw.day < 0) throw new Error('存档的日期字段损坏。');
  if (raw.version !== undefined && (typeof raw.version !== 'number' || !Number.isInteger(raw.version))) {
    throw new Error('存档版本号损坏。');
  }
}

function normalizeThread(t: Loose): StoryThread | null {
  if (!isObj(t)) return null;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.title !== 'string' || !t.title) return null;
  return {
    id: t.id,
    title: t.title.slice(0, 30),
    summary: typeof t.summary === 'string' ? t.summary.slice(0, 400) : '',
    openedDay: typeof t.openedDay === 'number' ? t.openedDay : 0,
    lastDay: typeof t.lastDay === 'number' ? t.lastDay : 0,
    status: t.status === 'closed' ? 'closed' : 'open',
    npcIds: Array.isArray(t.npcIds) ? t.npcIds.filter((x): x is string => typeof x === 'string').slice(0, 6) : [],
  };
}

/** v1 → v2：新增 AI 剧情线、NPC 记忆摘要、AI 预算状态 */
function v1ToV2(raw: Loose): Loose {
  const threads = Array.isArray(raw.storyThreads) ? raw.storyThreads : [];
  const npcs = Array.isArray(raw.npcs) ? raw.npcs : [];
  for (const n of npcs) {
    if (isObj(n) && typeof n.summary !== 'string') n.summary = '';
  }
  return {
    ...raw,
    version: 2,
    storyThreads: threads.map((t) => normalizeThread(t as Loose)).filter((t): t is StoryThread => !!t).slice(0, 6),
    ai: isObj(raw.ai) ? { ...emptyAi(), ...(raw.ai as Partial<AIState>) } : emptyAi(),
  };
}

/** 理财持仓规范化：清掉坏数据，限制条数与字段范围 */
function normalizeInvestments(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((i): i is Record<string, unknown> => isObj(i) && typeof i.id === 'string')
    .slice(0, 20)
    .map((i) => ({
      id: String(i.id),
      product: i.product === 'index' || i.product === 'high' ? i.product : 'fund',
      principal: Math.max(0, Math.round(Number(i.principal) || 0)),
      value: Math.max(0, Math.round(Number(i.value) || 0)),
      openedDay: Number(i.openedDay) || 0,
      ...(typeof i.lastRate === 'number' && Number.isFinite(i.lastRate) ? { lastRate: i.lastRate } : {}),
    }));
}

/** v2 → v3：新增储蓄、理财持仓、信用分 */
function v2ToV3(raw: Loose): Loose {
  const player = isObj(raw.player) ? { ...raw.player } : {};
  return {
    ...raw,
    version: 3,
    player: {
      ...player,
      savings: typeof player.savings === 'number' && Number.isFinite(player.savings) ? Math.max(0, Math.round(player.savings)) : 0,
      investments: normalizeInvestments(player.investments),
      credit: typeof player.credit === 'number' && Number.isFinite(player.credit) ? clampCredit(player.credit) : 640,
    },
  };
}

const clampCredit = (n: number) => Math.min(850, Math.max(300, Math.round(n)));

/** 职业技能字段规范化：0~100 整数，缺省 0 */
function normalizeSkills(raw: unknown): Record<string, number> {
  const out: Record<string, number> = { coding: 0, communication: 0, writing: 0, language: 0 };
  if (!isObj(raw)) return out;
  for (const k of Object.keys(out)) {
    const v = Number((raw as Loose)[k]);
    out[k] = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
  }
  return out;
}

/** 各职业线累计天数规范化：非负整数 */
function normalizeTrackDays(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = Math.round(n);
  }
  return out;
}

/** 老存档没有行业天数：拿现有工作与总工作天数粗略推导 */
function inferTrackDays(player: Loose): Record<string, number> {
  const jobId = typeof player.jobId === 'string' ? player.jobId : null;
  const workDays = typeof player.workDays === 'number' && player.workDays > 0 ? Math.round(player.workDays) : 0;
  if (!jobId || !workDays) return {};
  const track = JOB_TRACKS[jobId];
  return track ? { [track]: workDays } : {};
}

/** 职位 id → 职业线（避免 migrate 反向依赖引擎） */
const JOB_TRACKS: Record<string, string> = {
  cashier: 'service', shift_lead: 'service', store_manager: 'service',
  intern_dev: 'tech', junior_dev: 'tech', dev: 'tech', tech_lead: 'tech',
  sales_assistant: 'sales', specialist: 'sales', supervisor: 'sales', manager: 'sales',
  assistant: 'admin', hr_specialist: 'admin', hr_manager: 'admin',
  tutor: 'education', teacher: 'education', head_teacher: 'education',
};

/** v3 → v4：新增职业技能、行业资历、绩效与绩效评估基准 */
function v3ToV4(raw: Loose): Loose {
  const player = isObj(raw.player) ? { ...raw.player } : {};
  const workDays = typeof player.workDays === 'number' && player.workDays > 0 ? Math.round(player.workDays) : 0;
  return {
    ...raw,
    version: 4,
    player: {
      ...player,
      skills: normalizeSkills(player.skills),
      trackDays: isObj(player.trackDays) ? normalizeTrackDays(player.trackDays) : inferTrackDays(player),
      performance: typeof player.performance === 'number' && Number.isFinite(player.performance) ? Math.min(100, Math.max(0, Math.round(player.performance))) : 60,
      lastReviewWorkDays: typeof player.lastReviewWorkDays === 'number' && Number.isFinite(player.lastReviewWorkDays) ? Math.max(0, Math.round(player.lastReviewWorkDays)) : workDays,
    },
  };
}

const clampTrust = (n: number) => Math.min(100, Math.max(-100, Math.round(n)));

/** v4 → v5：NPC 增加信任、关系阶段与恋爱标记 */
function v4ToV5(raw: Loose): Loose {
  const npcs = Array.isArray(raw.npcs)
    ? raw.npcs.map((n) => {
      if (!isObj(n)) return n;
      const affinity = typeof n.affinity === 'number' && Number.isFinite(n.affinity) ? n.affinity : 0;
      return {
        ...n,
        trust: typeof n.trust === 'number' && Number.isFinite(n.trust) ? clampTrust(n.trust) : 0,
        stage: stageForAffinity(affinity),
        romanceable: typeof n.romanceable === 'boolean' ? n.romanceable : ROMANCEABLE_IDS.includes(String(n.id)),
      };
    })
    : [];
  return { ...raw, version: 5, npcs };
}

/** 贷款结构规范化：坏数据一律当作「没有贷款」，避免读档即负数 */
function normalizeBankLoan(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  const amount = Math.max(0, Math.round(Number(raw.amount) || 0));
  const remaining = Math.max(0, Math.round(Number(raw.remaining) || 0));
  if (!amount || !remaining) return null;
  return {
    amount,
    remaining,
    monthly: Math.max(1, Math.round(Number(raw.monthly) || 1)),
    rate: Math.min(1, Math.max(0, Number(raw.rate) || 0)),
    startedDay: Math.max(0, Math.round(Number(raw.startedDay) || 0)),
  };
}

/** v5 → v6：银行贷款字段 */
function v5ToV6(raw: Loose): Loose {
  const player = isObj(raw.player) ? { ...raw.player } : {};
  return { ...raw, version: 6, player: { ...player, bankLoan: normalizeBankLoan(player.bankLoan) } };
}

/** 资产列表规范化：去重、只保留已知资产、限制数量 */
function normalizeAssets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(ASSETS.map((a) => a.id));
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && known.has(x) && !out.includes(x)) out.push(x);
    if (out.length >= ASSETS.length) break;
  }
  return out;
}

/** v6 → v7：资产列表 */
function v6ToV7(raw: Loose): Loose {
  const player = isObj(raw.player) ? { ...raw.player } : {};
  return { ...raw, version: 7, player: { ...player, assets: normalizeAssets(player.assets) } };
}

/** v7 → v8：属性历史快照（每周一条） */
function v7ToV8(raw: Loose): Loose {
  return { ...raw, version: 8, attrHistory: normalizeAttrHistory(raw.attrHistory) };
}

/** 属性快照规范化：只保留六个合法属性、整数夹紧、条数与天数排序 */
function normalizeAttrHistory(raw: unknown): { day: number; attrs: Record<string, number> }[] {
  if (!Array.isArray(raw)) return [];
  const out: { day: number; attrs: Record<string, number> }[] = [];
  for (const item of raw) {
    if (!isObj(item) || !isObj(item.attrs)) continue;
    const day = Number(item.day);
    if (!Number.isFinite(day) || day < 0) continue;
    const attrs: Record<string, number> = {};
    for (const k of ['intelligence', 'eq', 'fitness', 'charm', 'happiness', 'health']) {
      const v = Number((item.attrs as Loose)[k]);
      attrs[k] = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
    }
    out.push({ day: Math.round(day), attrs });
  }
  return out.sort((a, b) => a.day - b.day).slice(-220);
}

/** 居住方式规范化：合法 id 保留，null 表示住家里；缺失时按身份推导 */
function normalizeHousing(raw: unknown, occupation: unknown): string | null {
  if (raw === null || raw === undefined) {
    // 老存档没有该字段：学生默认住家里/宿舍，其他身份默认开始租房（与原房租规则接近）
    return raw === undefined && occupation !== 'student' ? 'shared' : null;
  }
  if (raw === 'shared' || raw === 'studio') return raw;
  return null;
}

/** v8 → v9：居住方式 */
function v8ToV9(raw: Loose): Loose {
  const player = isObj(raw.player) ? { ...raw.player } : {};
  return { ...raw, version: 9, player: { ...player, housing: normalizeHousing(player.housing, player.occupation) } };
}

/** 本月工资累计字段规范化 */
function normalizeMoney0(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** v9 → v10：本月工资明细（税前/五险一金/个税） */
function v9ToV10(raw: Loose): Loose {
  const player = isObj(raw.player) ? { ...raw.player } : {};
  return {
    ...raw,
    version: 10,
    player: {
      ...player,
      monthGross: normalizeMoney0(player.monthGross),
      monthInsurance: normalizeMoney0(player.monthInsurance),
      monthTax: normalizeMoney0(player.monthTax),
    },
  };
}

interface Step { from: number; to: number; up(raw: Loose): Loose }

const STEPS: Step[] = [
  { from: 1, to: 2, up: v1ToV2 },
  { from: 2, to: 3, up: v2ToV3 },
  { from: 3, to: 4, up: v3ToV4 },
  { from: 4, to: 5, up: v4ToV5 },
  { from: 5, to: 6, up: v5ToV6 },
  { from: 6, to: 7, up: v6ToV7 },
  { from: 7, to: 8, up: v7ToV8 },
  { from: 8, to: 9, up: v8ToV9 },
  { from: 9, to: 10, up: v9ToV10 },
];

/** 把任意版本的存档升级到 CURRENT_VERSION；结构不合法则抛错 */
export function migrate(raw: unknown): GameState {
  assertShape(raw);
  let s: Loose = raw;
  let version = typeof s.version === 'number' ? s.version : 1;
  if (version > CURRENT_VERSION) {
    throw new Error(`存档版本（v${version}）比当前游戏更新，请更新游戏后再读取。`);
  }
  let guard = 0;
  while (version < CURRENT_VERSION) {
    const step = STEPS.find((x) => x.from === version);
    if (!step) throw new Error(`缺少从 v${version} 升级的迁移步骤。`);
    s = step.up(s);
    version = step.to;
    if (guard++ > 20) throw new Error('迁移链出现循环。');
  }
  return finalizeShape(s);
}

/** 迁移后兜底：补齐可选集合，确保引擎拿到的状态字段齐全 */
function finalizeShape(s: Loose): GameState {
  const st = s as unknown as GameState;
  st.version = CURRENT_VERSION;
  st.log ??= [];
  st.transactions ??= [];
  st.wealthHistory ??= [{ day: st.day, money: st.player.money }];
  st.attrHistory = normalizeAttrHistory(st.attrHistory) as unknown as GameState['attrHistory'];
  st.achievements ??= {};
  st.flags ??= {};
  st.todayCounts ??= {};
  st.morningReport ??= [];
  st.seenEvents ??= {};
  st.pendingEvent ??= null;
  st.storyThreads ??= [];
  // 无论哪个版本，剧情线都必须重新规范化并限制条数（防止手工改档/旧数据越界）
  st.storyThreads = st.storyThreads
    .map((t) => normalizeThread(t as unknown as Loose))
    .filter((t): t is StoryThread => !!t)
    .slice(0, 6);
  st.ai ??= emptyAi();
  st.player.workDays ??= 0;
  st.player.jobId ??= null;
  st.player.savings ??= 0;
  st.player.credit ??= 640;
  // 经济字段每次读取都重新规范化（防止手工改档 / 旧数据出现负储蓄或坏持仓）
  st.player.savings = typeof st.player.savings === 'number' && Number.isFinite(st.player.savings) ? Math.max(0, Math.round(st.player.savings)) : 0;
  st.player.credit = typeof st.player.credit === 'number' && Number.isFinite(st.player.credit) ? clampCredit(st.player.credit) : 640;
  st.player.bankLoan = normalizeBankLoan(st.player.bankLoan) as unknown as GameState['player']['bankLoan'];
  st.player.assets = normalizeAssets(st.player.assets);
  st.player.housing = normalizeHousing(st.player.housing, st.player.occupation) as unknown as GameState['player']['housing'];
  st.player.monthGross = normalizeMoney0(st.player.monthGross);
  st.player.monthInsurance = normalizeMoney0(st.player.monthInsurance);
  st.player.monthTax = normalizeMoney0(st.player.monthTax);
  st.player.investments = normalizeInvestments(st.player.investments) as unknown as GameState['player']['investments'];
  // 职业字段重新规范化（技能 0~100、绩效 0~100、行业天数非负）
  st.player.skills = normalizeSkills(st.player.skills) as unknown as GameState['player']['skills'];
  st.player.trackDays = normalizeTrackDays(st.player.trackDays) as unknown as GameState['player']['trackDays'];
  st.player.performance = typeof st.player.performance === 'number' && Number.isFinite(st.player.performance)
    ? Math.min(100, Math.max(0, Math.round(st.player.performance))) : 60;
  st.player.lastReviewWorkDays = typeof st.player.lastReviewWorkDays === 'number' && Number.isFinite(st.player.lastReviewWorkDays)
    ? Math.max(0, Math.round(st.player.lastReviewWorkDays)) : st.player.workDays;
  st.stats ??= { totalEarned: 0, totalSpent: 0, daysWorked: 0, eventsResolved: 0, actionsDone: 0 };
  for (const n of st.npcs) {
    n.summary ??= '';
    n.memories ??= [];
    n.links ??= [];
    n.trust = typeof n.trust === 'number' && Number.isFinite(n.trust) ? clampTrust(n.trust) : 0;
    n.stage = stageForAffinity(typeof n.affinity === 'number' ? n.affinity : 0);
    if (typeof n.romanceable !== 'boolean') n.romanceable = ROMANCEABLE_IDS.includes(n.id);
  }
  return st;
}