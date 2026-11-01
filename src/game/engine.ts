/**
 * 规则引擎：游戏状态的唯一修改入口。
 * - 所有函数都是纯函数：(state, 参数, rng) => { state: 新状态, result }
 * - 失败时返回原 state 引用（不变），result.ok = false 并给出原因
 * - AI / 玩家自由输入只能产生「提案」，数值由 applyEffects 统一裁决与夹紧
 */
import {
  ACHIEVEMENTS, ACTIVITIES, ALLOCATION_MAX_EACH, ATTR_META, ALLOCATION_POOL, ATTR_KEYS, ATTR_MAX, ATTR_MIN, ASSETS, BACKGROUNDS, BASE_ATTRS, INVESTMENT_PRODUCTS, INVEST_MAX, INVEST_MIN,
  JOBS, LIVING_COST, LOAN_LIMIT_FACTOR, LOAN_MAX, LOAN_MIN, LOAN_MIN_CREDIT, LOAN_TERM, SAVINGS_ANNUAL_RATE, SKILL_GROWTH, SKILL_MAX, SKILL_META, TRACK_META, MAX_AP, MAX_ATTR_DELTA, MAX_MONEY_DELTA, PERSONALITIES, SOFTCAP_KEYS, START_ISO,
  getAssetById, getHousingById, getInvestmentProduct, getJobById, housingOf, moveCostOf, nextJobInTrack, unmetRequirements,
} from './content';
import type { Activity } from './content';
import { EVENT_BY_ID, EVENT_DEFS, instantiateEvent, isEligible } from './events';
import { CURRENT_VERSION } from './migrate';
import {
  HELP_BY_RELATION, INTERACTIONS, KIND_TRAIT_BONUS, MOOD_BONUS, REACH_LINES, STAGE_META, STATUS_POOL, createInitialNpcs, dialogueLine, stageForAffinity,
} from './npcs';
import type { InteractionKind } from './npcs';
import type {
  AIActionProposal, ActionResult, ActivityCategory, Attrs, CreateInput, Deltas, Effects, EngineResult, EventCategory, EventOutcome,
  GameEvent, GameState, HousingId, Investment, InvestmentProduct, JobTrack, LogKind, Memory, Mood, NPC, RelationStage, SkillKey, TxCategory,
} from './types';
import { calcAge, clamp, dateParts, formatDate, isBirthday, isWeekend, pick, resolveDelta, uid, weightedPick } from './util';
import type { RNG } from './util';
import { checkChance, interpretFreeAction, validateProposal } from './validate';
import { salaryBreakdown } from './tax';
import { RETIRE_AGE, lifeStageFor } from './life';

const clone = <T>(x: T): T => structuredClone(x);
const emptyDeltas = (): Deltas => ({ attrs: {}, money: 0, knowledge: 0, ap: 0, npc: [] });
const pad = (n: number) => String(n).padStart(2, '0');

// ===================== 只读查询 =====================
export const getDate = (s: GameState, offset = 0) => dateParts(s.startISO, s.day + offset);
export const getAge = (s: GameState) => calcAge(s.player.birthISO, getDate(s));
export const getJob = (s: GameState) => getJobById(s.player.jobId);

export function buildInitialAttrs(input: Pick<CreateInput, 'personality' | 'background' | 'allocation'>): Attrs {
  const a: Attrs = { ...BASE_ATTRS };
  for (const k of ['intelligence', 'eq', 'fitness', 'charm'] as const) a[k] += clamp(Math.round(input.allocation[k] || 0), 0, ALLOCATION_MAX_EACH);
  for (const [k, v] of Object.entries(PERSONALITIES[input.personality].mods)) a[k as keyof Attrs] += v ?? 0;
  for (const [k, v] of Object.entries(BACKGROUNDS[input.background].mods)) a[k as keyof Attrs] += v ?? 0;
  for (const k of ATTR_KEYS) a[k] = clamp(a[k], 5, 95);
  return a;
}

export function getStatusTags(s: GameState): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }[] {
  const a = s.player.attrs;
  const tags: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }[] = [];
  const occ = s.player.occupation === 'student' ? '在读学生' : s.player.occupation === 'employed' ? '全职上班族' : '待业中';
  tags.push({ label: occ, tone: 'neutral' });
  const job = getJob(s);
  if (job?.partTime) tags.push({ label: `兼职：${job.name}`, tone: 'neutral' });
  if (a.health < 30) tags.push({ label: '体力不支', tone: 'bad' });
  else if (a.health > 80) tags.push({ label: '精力充沛', tone: 'good' });
  if (a.happiness < 30) tags.push({ label: '情绪低落', tone: 'bad' });
  else if (a.happiness > 75) tags.push({ label: '心情很好', tone: 'good' });
  if (s.player.money < 0) tags.push({ label: '负债中', tone: 'bad' });
  else if (s.player.money < 500) tags.push({ label: '手头很紧', tone: 'warn' });
  if (s.ap <= 2) tags.push({ label: '精疲力竭', tone: 'warn' });
  return tags;
}

// ===================== 内部：日志 / 账本 / 记忆 =====================
function addLog(s: GameState, kind: LogKind, title: string, text: string, importance: 1 | 2 | 3 = 1) {
  s.log.push({ id: uid('lg'), day: s.day, kind, title, text, importance });
  if (s.log.length > 700) {
    // 优先丢弃最旧的低重要度记录
    const idx = s.log.findIndex((l) => l.importance === 1);
    s.log.splice(idx >= 0 ? idx : 0, 1);
  }
}
function addTx(s: GameState, amount: number, category: TxCategory, note: string) {
  if (!amount) return;
  s.transactions.push({ id: uid('tx'), day: s.day, amount, category, note });
  if (s.transactions.length > 700) s.transactions.shift();
  if (amount > 0) s.stats.totalEarned += amount;
  else s.stats.totalSpent += -amount;
}
function addMemory(npc: NPC, day: number, text: string, tone: Memory['tone']) {
  npc.memories.push({ day, text, tone });
  if (npc.memories.length > 40) npc.memories.shift();
}

// ===================== 内部：统一的效果结算 =====================
/**
 * 边际递减：属性越高越难涨。技能类 44 时约 58%、60 时 30%、70 时 12%、80 时 4%；
 * 幸福感 / 健康更宽松，但接近上限同样变慢。
 */
function softcap(k: keyof Attrs, cur: number): number {
  if (SOFTCAP_KEYS.includes(k)) return clamp(((100 - cur) / 60) ** 3, 0.02, 1.3);
  return clamp((100 - cur) / 50, 0.15, 1.2);
}
interface ApplyOpts { label: string; txCat: TxCategory; trusted: boolean; fatigue?: boolean }

function applyEffects(s: GameState, fx: Effects, rng: RNG, o: ApplyOpts): Deltas {
  const d = emptyDeltas();
  const fatigue = o.fatigue ? 0.6 : 1;
  for (const k of ATTR_KEYS) {
    let v = fx.attrs?.[k];
    if (!v || !Number.isFinite(v)) continue;
    v = clamp(v, -MAX_ATTR_DELTA, MAX_ATTR_DELTA);
    if (v > 0) {
      v *= fatigue;
      v *= softcap(k, s.player.attrs[k]);
      if (SOFTCAP_KEYS.includes(k)) v *= SKILL_GROWTH;
    }
    const before = s.player.attrs[k];
    const after = clamp(before + resolveDelta(v, rng), ATTR_MIN, ATTR_MAX);
    s.player.attrs[k] = after;
    if (after !== before) d.attrs[k] = after - before;
  }
  if (fx.money && Number.isFinite(fx.money)) {
    const m = Math.round(clamp(fx.money, -MAX_MONEY_DELTA, MAX_MONEY_DELTA));
    if (m) { s.player.money += m; d.money += m; addTx(s, m, o.txCat, o.label); }
  }
  if (fx.knowledge && Number.isFinite(fx.knowledge)) {
    const before = s.player.knowledge;
    s.player.knowledge = Math.max(0, Math.round(before + fx.knowledge));
    d.knowledge = s.player.knowledge - before;
  }
  if (fx.ap) {
    const before = s.ap;
    s.ap = clamp(s.ap + fx.ap, 0, s.maxAp);
    d.ap += s.ap - before;
  }
  for (const ne of fx.npc ?? []) {
    const npc = s.npcs.find((n) => n.id === ne.id);
    if (!npc) continue;
    if (!npc.met) { if (!o.trusted) continue; npc.met = true; }
    let aff = clamp(ne.affinity ?? 0, -15, 15);
    if (aff > 0) aff *= clamp((100 - npc.affinity) / 80, 0.08, 0.9); // 关系越深越难再进一步
    aff = Math.round(aff);
    const before = npc.affinity;
    npc.affinity = clamp(before + aff, -100, 100);
    if (ne.mood) npc.mood = ne.mood;
    if (ne.memory) addMemory(npc, s.day, ne.memory, aff > 0 ? 'good' : aff < 0 ? 'bad' : 'neutral');
    npc.lastContactDay = s.day;
    d.npc.push({ name: npc.name, affinity: npc.affinity - before });
  }
  if (o.trusted) {
    if (fx.flags) Object.assign(s.flags, fx.flags);
    if (fx.occupation) s.player.occupation = fx.occupation;
  }
  return d;
}

function mergeDeltas(a: Deltas, b: Deltas): Deltas {
  const attrs = { ...a.attrs };
  for (const k of ATTR_KEYS) if (b.attrs[k]) attrs[k] = (attrs[k] ?? 0) + (b.attrs[k] as number);
  return { attrs, money: a.money + b.money, knowledge: a.knowledge + b.knowledge, ap: a.ap + b.ap, npc: [...a.npc, ...b.npc] };
}

function diffDeltas(before: GameState, after: GameState): Deltas {
  const d = emptyDeltas();
  for (const k of ATTR_KEYS) { const x = after.player.attrs[k] - before.player.attrs[k]; if (x) d.attrs[k] = x; }
  d.money = after.player.money - before.player.money;
  d.knowledge = after.player.knowledge - before.player.knowledge;
  return d;
}

// ===================== 内部：成功 / 失败 / 收尾 =====================
function fail(state: GameState, reason: string, title = '无法执行'): EngineResult {
  return { state, result: { ok: false, title, text: reason, deltas: emptyDeltas() } };
}

function checkAchievements(s: GameState): string[] {
  const names: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!(a.id in s.achievements) && a.check(s)) {
      s.achievements[a.id] = s.day;
      names.push(`${a.icon} ${a.name}`);
      addLog(s, 'achievement', `成就达成：${a.name}`, a.desc, 3);
    }
  }
  return names;
}
function finalize(s: GameState, result: ActionResult): EngineResult {
  const unlocked = checkAchievements(s);
  if (unlocked.length) result.unlocked = unlocked;
  s.updatedAt = Date.now();
  return { state: s, result };
}

function guard(s: GameState, ap: number, money = 0): string | null {
  if (s.pendingEvent) return '眼前有一件事需要你先做决定。';
  if (ap > s.ap) return `行动点不足：需要 ${ap}，今天只剩 ${s.ap}。`;
  // 免费行动（money = 0）在负债时也应该能做；只有真正需要花钱的行动才检查余额
  if (money > 0 && money > s.player.money) return `钱不够：需要 ¥${money}，你只有 ¥${Math.max(0, Math.round(s.player.money))}。`;
  return null;
}

const EVENT_CAT_OF: Record<ActivityCategory, EventCategory> = {
  study: 'study', work: 'work', social: 'social', exercise: 'daily', entertainment: 'daily', rest: 'daily',
};
const TX_CAT_OF: Record<ActivityCategory | 'other', TxCategory> = {
  study: '学习', work: '工资', social: '社交', exercise: '运动', entertainment: '娱乐', rest: '其他', other: '其他',
};

function maybeTrigger(s: GameState, cat: EventCategory, chance: number, rng: RNG): boolean {
  if (s.pendingEvent || rng() > chance) return false;
  const defs = EVENT_DEFS.filter((d) => d.category === cat && !d.priority && d.weight > 0 && isEligible(d, s));
  if (!defs.length) return false;
  const def = weightedPick(defs, rng);
  const ev = instantiateEvent(def, s, rng);
  if (!ev) return false;
  s.pendingEvent = ev;
  return true;
}

function personalityShift(s: GameState, cat: ActivityCategory): number {
  const p = PERSONALITIES[s.player.personality];
  return (p.likes.includes(cat) ? 1 : 0) - (p.dislikes.includes(cat) ? 1 : 0);
}
const bumpCount = (s: GameState, cat: ActivityCategory) => {
  const n = (s.todayCounts[cat] ?? 0) + 1;
  s.todayCounts[cat] = n;
  return n;
};

// ===================== 新游戏 =====================
export function createNewGame(input: CreateInput, rng: RNG = Math.random): GameState {
  const bg = BACKGROUNDS[input.background];
  // 出生日期：开局时恰好 18 岁
  const birth = new Date(Date.UTC(2008, 8, 1 - Math.floor(rng() * 365)));
  const bm = birth.getUTCMonth() + 1;
  const bd = bm === 2 && birth.getUTCDate() === 29 ? 28 : birth.getUTCDate();
  const alloc = { ...input.allocation };
  let total = 0;
  for (const k of ['intelligence', 'eq', 'fitness', 'charm'] as const) {
    alloc[k] = clamp(Math.round(alloc[k] || 0), 0, ALLOCATION_MAX_EACH);
    total += alloc[k];
  }
  if (total > ALLOCATION_POOL) for (const k of ['intelligence', 'eq', 'fitness', 'charm'] as const) alloc[k] = Math.floor((alloc[k] * ALLOCATION_POOL) / total);

  const s: GameState = {
    version: CURRENT_VERSION, id: uid('save'), createdAt: Date.now(), updatedAt: Date.now(), startISO: START_ISO, day: 0, ap: MAX_AP, maxAp: MAX_AP,
    player: {
      name: input.name.trim().slice(0, 12) || '无名氏', gender: input.gender, personality: input.personality, background: input.background,
      hobbies: input.hobbies.slice(0, 3), attrs: buildInitialAttrs({ ...input, allocation: alloc }), money: bg.money, knowledge: 0,
      occupation: 'unemployed', jobId: null, workDays: 0, birthISO: `${birth.getUTCFullYear()}-${pad(bm)}-${pad(bd)}`,
      savings: 0, investments: [], credit: 640, bankLoan: null, assets: [], housing: null,
      monthGross: 0, monthInsurance: 0, monthTax: 0,
      skills: { coding: 0, communication: 0, writing: 0, language: 0 }, trackDays: {}, performance: 60, lastReviewWorkDays: 0,
    },
    npcs: createInitialNpcs(), pendingEvent: null, log: [], transactions: [], wealthHistory: [{ day: 0, money: bg.money }],
    attrHistory: [],
    achievements: {}, flags: { lifeStage: 'study' }, todayCounts: {}, morningReport: [], seenEvents: {},
    stats: { totalEarned: 0, totalSpent: 0, daysWorked: 0, eventsResolved: 0, actionsDone: 0 },
    storyThreads: [], ai: { day: 0, calls: 0, failures: 0, cooldownUntil: 0 },
  };
  s.attrHistory.push({ day: 0, attrs: { ...s.player.attrs } });
  addLog(s, 'system', '人生开始', `${s.player.name}，十八岁。${bg.label}出身，一个崭新的故事就此展开。`, 3);
  s.pendingEvent = instantiateEvent(EVENT_BY_ID.opening, s, rng);
  return s;
}

// ===================== 行动 =====================
export function activityBlockReason(s: GameState, a: Activity): string | null {
  if (a.when) { const r = a.when(s); if (r) return r; }
  return guard(s, a.ap, a.money);
}

export function performActivity(input: GameState, id: string, rng: RNG = Math.random): EngineResult {
  const act = ACTIVITIES.find((a) => a.id === id);
  if (!act) return fail(input, '未知的行动。');
  const reason = activityBlockReason(input, act);
  if (reason) return fail(input, reason);
  const s = clone(input);
  s.ap -= act.ap;
  s.stats.actionsDone++;
  const count = bumpCount(s, act.category);
  const fatigue = count >= 3;
  if (act.money) { s.player.money -= act.money; addTx(s, -act.money, TX_CAT_OF[act.category], act.name); }

  const fx: Effects = { ...act.effects, attrs: { ...act.effects.attrs } };
  // 资产加成（3.1.5）：只放大收益，不改变行动成本
  if (act.category === 'study' && hasAsset(s, 'laptop')) fx.knowledge = Math.round((fx.knowledge ?? 0) * 1.15);
  if (act.category === 'exercise' && hasAsset(s, 'bike')) {
    fx.attrs!.fitness = (fx.attrs!.fitness ?? 0) * 1.2;
    if (fx.attrs!.health) fx.attrs!.health *= 1.2;
  }
  if (act.category === 'entertainment') {
    if (hasAsset(s, 'guitar')) fx.attrs!.happiness = (fx.attrs!.happiness ?? 0) + 1;
    if (hasAsset(s, 'camera')) {
      fx.attrs!.happiness = (fx.attrs!.happiness ?? 0) + 0.5;
      fx.knowledge = (fx.knowledge ?? 0) + 2;
    }
  }
  let hap = personalityShift(s, act.category);
  const hobby = act.hobbies?.find((h) => s.player.hobbies.includes(h));
  if (hobby) hap += 1.5;
  fx.attrs!.happiness = (fx.attrs!.happiness ?? 0) + hap;
  if (act.socialNpc) {
    const met = s.npcs.filter((n) => n.met);
    if (met.length) fx.npc = [{ id: pick(met, rng).id, affinity: act.socialNpc, memory: `一起参加了「${act.name}」` }];
  }
  const deltas = applyEffects(s, fx, rng, { label: act.name, txCat: TX_CAT_OF[act.category], trusted: true, fatigue });
  deltas.ap = -act.ap;
  deltas.money -= act.money;

  let text = pick(act.narr, rng).replace('{hobby}', hobby ?? pick(s.player.hobbies.length ? s.player.hobbies : ['兴趣'], rng));
  if (act.special === 'meet') text = meetSomeone(s, rng, deltas);
  if (hobby && act.special !== 'hobby') text += `（正好是你的爱好「${hobby}」，心情更好了。）`;
  if (act.skill && act.skillGain) {
    const skillMul = act.skill === 'coding' && hasAsset(s, 'laptop') ? 1.25 : 1;
    const gain = bumpSkill(s, act.skill, act.skillGain * skillMul, rng);
    if (gain > 0) text += `（${SKILL_META[act.skill].label} +${gain}）`;
  }
  if (fatigue) text += ' 同类活动做得太多，有些疲惫，收效递减。';
  const evt = maybeTrigger(s, EVENT_CAT_OF[act.category], 0.12, rng);
  if (evt) text += ' …… 就在这时，有事情发生了。';
  addLog(s, 'action', act.name, text, 1);
  return finalize(s, { ok: true, title: act.name, text, deltas, eventTriggered: evt });
}

function meetSomeone(s: GameState, rng: RNG, deltas: Deltas): string {
  const occ = s.player.occupation;
  const cands = s.npcs.filter((n) => !n.met && (n.requires === 'student' ? occ === 'student' : n.requires === 'cashier' ? false : true));
  if (!cands.length) return '你认识的人已经够多了，今天只是和老朋友们打了几声招呼。';
  const p = clamp(0.4 + s.player.attrs.charm / 200, 0.4, 0.85);
  if (rng() > p) return '你在人群里转了一圈，没遇到特别投缘的人，但也练了练胆量。';
  const n = pick(cands, rng);
  n.met = true;
  n.affinity = Math.max(n.affinity, 5);
  n.lastContactDay = s.day;
  addMemory(n, s.day, '第一次见面，互相留下了印象。', 'good');
  deltas.npc.push({ name: n.name, affinity: 5 });
  addLog(s, 'social', `结识了${n.name}`, `${n.role}。${n.background}`, 2);
  return `你认识了新朋友：${n.name}（${n.role}）。TA 已加入你的社交列表。`;
}

// ===================== 职业技能（第三阶段） =====================
/** 技能成长：越接近 100 越慢（与属性软上限同一思路），返回实际增量 */
function bumpSkill(s: GameState, key: SkillKey, amount: number, rng: RNG): number {
  const cur = s.player.skills[key] ?? 0;
  const soft = clamp((SKILL_MAX - cur) / 40, 0.08, 1);
  const gain = resolveDelta(amount * soft, rng);
  s.player.skills[key] = clamp(cur + gain, 0, SKILL_MAX);
  return s.player.skills[key] - cur;
}

/** 绩效与行业资历的只读摘要（UI 用） */
export function careerStatus(s: GameState): {
  job: ReturnType<typeof getJob>; next: ReturnType<typeof getJob>;
  performance: number; trackDays: number; trackLabel: string; skillLabel: string; skill: number;
} {
  const job = getJob(s);
  const track = job?.track ?? null;
  const meta = track ? TRACK_META[track] : null;
  return {
    job,
    next: job ? nextJobInTrack(job, s) : null,
    performance: Math.round(s.player.performance),
    trackDays: track ? s.player.trackDays[track] ?? 0 : 0,
    trackLabel: meta?.label ?? '—',
    skillLabel: meta ? SKILL_META[meta.skill].label : '—',
    skill: meta ? s.player.skills[meta.skill] ?? 0 : 0,
  };
}

/**
 * 每月初的绩效评估：出勤、奖金、晋升、PIP 与裁员。
 * 规则：
 *  - 绩效变化 = clamp((本月出勤 - 期望出勤) × 2, -20, +12)；
 *  - 绩效 ≥ 80 发绩效奖金（工资的 30%）；
 *  - 连续 2 个月 ≥ 85 且下一级条件满足 → 自动晋升；
 *  - 连续 2 个月 ≤ 30 → PIP 警告；第 3 个月仍 ≤ 30 → 被裁员。
 */
function reviewCareer(s: GameState, rng: RNG, report: string[]) {
  const job = getJob(s);
  if (!job) {
    s.player.lastReviewWorkDays = s.player.workDays;
    delete s.flags.perfHigh;
    delete s.flags.perfLow;
    return;
  }
  const worked = Math.max(0, s.player.workDays - s.player.lastReviewWorkDays);
  s.player.lastReviewWorkDays = s.player.workDays;
  const expected = job.partTime ? 8 : 18;
  const delta = clamp((worked - expected) * 2, -20, 12);
  s.player.performance = clamp(s.player.performance + delta, 0, 100);
  const perf = s.player.performance;

  if (perf >= 80) {
    const bonus = Math.round(job.wage * 0.3);
    s.player.money += bonus;
    addTx(s, bonus, '工资', `绩效奖金：${job.name}`);
    report.push(`💰 绩效 ${Math.round(perf)}，拿到绩效奖金 ¥${bonus}。`);
    addLog(s, 'work', '绩效奖金', `本月绩效 ${Math.round(perf)}，奖金 ¥${bonus}。`, 1);
  } else if (perf <= 45) {
    report.push(`📉 本月绩效只有 ${Math.round(perf)}，注意出勤与状态。`);
  }

  if (perf >= 85) s.flags.perfHigh = (typeof s.flags.perfHigh === 'number' ? s.flags.perfHigh : 0) + 1;
  else delete s.flags.perfHigh;

  if (typeof s.flags.perfHigh === 'number' && s.flags.perfHigh >= 2) {
    const next = nextJobInTrack(job, s);
    if (next) {
      s.player.jobId = next.id;
      if (!next.partTime) s.player.occupation = 'employed';
      delete s.flags.perfHigh;
      s.player.performance = clamp(perf - 15, 0, 100); // 晋升后重置一部分绩效压力
      s.flags.promotions = (typeof s.flags.promotions === 'number' ? s.flags.promotions : 0) + 1;
      report.push(`🎉 连续表现优秀，你晋升为「${next.name}」！`);
      addLog(s, 'work', `晋升：${next.name}`, `绩效连续两个月达到 85 以上，你被提拔为「${next.name}」。`, 3);
    } else {
      s.flags.perfHigh = 1; // 条件未满足，保留一次优秀记录
    }
  }

  if (perf <= 30) s.flags.perfLow = (typeof s.flags.perfLow === 'number' ? s.flags.perfLow : 0) + 1;
  else delete s.flags.perfLow;

  if (typeof s.flags.perfLow === 'number' && s.flags.perfLow === 2) {
    report.push('⚠️ 你收到了改进计划（PIP）通知：下个月必须拿出成绩。');
    addLog(s, 'work', '绩效警告', `连续两个月绩效低于 31，你收到了改进计划（PIP）。`, 2);
  }
  if (typeof s.flags.perfLow === 'number' && s.flags.perfLow >= 3) {
    const name = job.name;
    s.player.jobId = null;
    if (s.player.occupation === 'employed') s.player.occupation = 'unemployed';
    delete s.flags.perfLow;
    s.flags.laidOffDay = s.day;
    s.player.performance = 50;
    report.push(`🚪 你被「${name}」裁员了，需要重新找工作。`);
    addLog(s, 'work', '被裁员', `连续三个月绩效不达标，公司与你解除了劳动合同。`, 3);
    applyEffects(s, { attrs: { happiness: -8, health: -2 } }, rng, { label: '失业打击', txCat: '其他', trusted: true });
  }
}

// ===================== 工作 =====================
export function performWork(input: GameState, rng: RNG = Math.random): EngineResult {
  const job = getJob(input);
  if (!job) return fail(input, '你还没有工作，先去应聘一份吧。');
  if (job.weekdaysOnly && isWeekend(getDate(input))) return fail(input, '今天是周末，这份工作不用上班。');
  if (input.todayCounts.work) return fail(input, '今天已经上过班了。想多赚点？试试加班。');
  const g = guard(input, job.ap);
  if (g) return fail(input, g);
  const s = clone(input);
  s.ap -= job.ap;
  s.todayCounts.work = 1;
  s.stats.actionsDone++;
  s.stats.daysWorked++;
  s.player.workDays++;
  s.player.trackDays[job.track] = (s.player.trackDays[job.track] ?? 0) + 1;
  s.player.performance = clamp(s.player.performance + (job.partTime ? 1 : 2), 0, 100);
  const skillKey = TRACK_META[job.track].skill;
  const skillMul = skillKey === 'coding' && hasAsset(s, 'laptop') ? 1.2 : 1;
  const skillGain = bumpSkill(s, skillKey, (0.6 + job.level * 0.35) * skillMul, rng);
  // 绩效越高，工资越有议价空间（60 为基准，90 绩效约 +10%）
  const perfBonus = 1 + (s.player.performance - 60) / 300;
  const gross = Math.round(job.wage * (0.92 + rng() * 0.16) * perfBonus * (s.player.attrs.health < 30 ? 0.8 : 1));
  // 税前 → 五险一金 → 个税 → 到手（兼职不缴五险一金；本月累计计税）
  const pay = salaryBreakdown({
    gross, partTime: job.partTime,
    monthGross: s.player.monthGross, monthInsurance: s.player.monthInsurance, monthTax: s.player.monthTax,
  });
  s.player.monthGross += gross;
  s.player.monthInsurance += pay.insurance;
  s.player.monthTax += pay.tax;
  const deltas = applyEffects(s, {
    money: pay.net,
    attrs: { happiness: -0.8 + personalityShift(s, 'work'), health: job.partTime ? -0.4 : -0.9, eq: 0.4, intelligence: 0.3 },
    knowledge: job.level * 1.5,
  }, rng, { label: `${job.name}（到手）`, txCat: '工资', trusted: true });
  deltas.ap = -job.ap;
  let text = `${pick(job.narr, rng)} 到手 ¥${pay.net} 已到账。`;
  if (pay.insurance || pay.tax) text += `（税前 ¥${gross}，五险一金 ¥${pay.insurance}，个税 ¥${pay.tax}）`;
  if (skillGain > 0) text += `（${SKILL_META[skillKey].label} +${skillGain}）`;
  const evt = maybeTrigger(s, 'work', 0.18, rng);
  if (evt) text += ' …… 工作中出了点状况。';
  addLog(s, 'work', `上班：${job.name}`, text, 1);
  return finalize(s, { ok: true, title: `上班：${job.name}`, text, deltas, eventTriggered: evt });
}

export function performOvertime(input: GameState, rng: RNG = Math.random): EngineResult {
  const job = getJob(input);
  if (!job) return fail(input, '你还没有工作。');
  if (!input.todayCounts.work) return fail(input, '要先正常上班，才谈得上加班。');
  if (input.flags.overtimeDay === input.day) return fail(input, '今天已经加过班了，再加下去要出人命。');
  const g = guard(input, 3);
  if (g) return fail(input, g);
  const s = clone(input);
  s.ap -= 3;
  s.flags.overtimeDay = s.day;
  s.player.performance = clamp(s.player.performance + 3, 0, 100);
  const gross = Math.round(job.wage * 0.45);
  const ot = salaryBreakdown({
    gross, partTime: job.partTime,
    monthGross: s.player.monthGross, monthInsurance: s.player.monthInsurance, monthTax: s.player.monthTax,
  });
  s.player.monthGross += gross;
  s.player.monthInsurance += ot.insurance;
  s.player.monthTax += ot.tax;
  const deltas = applyEffects(s, { money: ot.net, attrs: { health: -2.5, happiness: -2.5 }, knowledge: 1 }, rng, { label: `加班：${job.name}（到手）`, txCat: '工资', trusted: true });
  deltas.ap = -3;
  const text = `你留下来多干了几个小时，到手加班费 ¥${ot.net}${ot.insurance || ot.tax ? `（税前 ¥${gross}，五险一金 ¥${ot.insurance}，个税 ¥${ot.tax}）` : ''}，但整个人像被抽空了。`;
  addLog(s, 'work', `加班：${job.name}`, text, 1);
  return finalize(s, { ok: true, title: '加班', text, deltas });
}

export function applyForJob(input: GameState, jobId: string, rng: RNG = Math.random): EngineResult {
  const job = JOBS.find((j) => j.id === jobId);
  if (!job) return fail(input, '没有这个职位。');
  if (input.player.jobId === job.id) return fail(input, '你已经在这个岗位上了。');
  if (input.player.occupation === 'student' && !job.partTime) return fail(input, '在读期间只能申请兼职，毕业后才能全职。');
  const unmet = unmetRequirements(input, job);
  if (unmet.length) return fail(input, `条件还不够：${unmet.join('、')}`, '应聘被拒');
  const g = guard(input, 2);
  if (g) return fail(input, g);
  const s = clone(input);
  s.ap -= 2;
  // 转行惩罚：跨职业线跳槽时面试成功率下降（行业资历从 0 开始）
  const prevJob = getJob(input);
  const crossTrack = !!prevJob && prevJob.track !== job.track;
  const chance = (job.partTime ? 0.88 : clamp(0.55 + (s.player.attrs.eq + s.player.attrs.charm - 80) / 400, 0.4, 0.9)) - (crossTrack ? 0.12 : 0);
  if (rng() > chance) {
    const text = `面试官客气地说「再考虑考虑」。你没拿到「${job.name}」，但积累了面试经验。`;
    const deltas = applyEffects(s, { attrs: { happiness: -2, eq: 0.5 } }, rng, { label: '应聘失败', txCat: '其他', trusted: true });
    deltas.ap = -2;
    addLog(s, 'work', `应聘失败：${job.name}`, text, 1);
    return finalize(s, { ok: true, title: '应聘未通过', text, deltas });
  }
  const promoted = !!input.player.jobId;
  s.player.jobId = job.id;
  if (!job.partTime) s.player.occupation = 'employed';
  const deltas = applyEffects(s, { attrs: { happiness: 5, charm: 0.5 } }, rng, { label: '入职', txCat: '其他', trusted: true });
  deltas.ap = -2;
  if (job.id === 'cashier') {
    const w = s.npcs.find((n) => n.id === 'wang');
    if (w && !w.met) { w.met = true; w.affinity = 8; addMemory(w, s.day, '你来店里面试，她打量了你半天才点头。', 'neutral'); deltas.npc.push({ name: w.name, affinity: 8 }); }
  }
  const text = `${promoted ? '跳槽成功！' : '拿到 offer 了！'}你成为了「${job.name}」（${TRACK_META[job.track].label}线）${crossTrack ? '，不过跨行意味着行业资历要重新积累' : ''}，单次工资约 ¥${job.wage}。`;
  addLog(s, 'work', `入职：${job.name}`, text, 3);
  return finalize(s, { ok: true, title: `入职：${job.name}`, text, deltas });
}

export function quitJob(input: GameState): EngineResult {
  const job = getJob(input);
  if (!job) return fail(input, '你现在没有工作。');
  const s = clone(input);
  s.player.jobId = null;
  if (s.player.occupation === 'employed') s.player.occupation = 'unemployed';
  const text = `你递交了辞呈，离开了「${job.name}」。`;
  addLog(s, 'work', '辞职', text, 2);
  return finalize(s, { ok: true, title: '辞职', text, deltas: emptyDeltas() });
}

// ===================== 自由行动 =====================
export function performFreeAction(input: GameState, text: string, rng: RNG = Math.random, proposal?: AIActionProposal): EngineResult {
  if (input.pendingEvent) return fail(input, '眼前有一件事需要你先做决定。');
  let prop = proposal;
  if (!prop) {
    const r = interpretFreeAction(input, text);
    if (r.kind === 'reject') return fail(input, r.reason, '规则引擎拒绝了这个行动');
    if (r.kind === 'work') return performWork(input, rng);
    prop = r.proposal;
  }
  const v = validateProposal(input, prop);
  if (!v.ok) return fail(input, v.reason, '规则引擎拒绝了这个行动');
  const p = v.value;
  const s = clone(input);
  s.ap -= p.apCost;
  s.stats.actionsDone++;
  let fatigue = false;
  if (p.category !== 'other') fatigue = bumpCount(s, p.category) >= 3;
  if (p.moneyCost) { s.player.money -= p.moneyCost; addTx(s, -p.moneyCost, TX_CAT_OF[p.category], p.title); }
  const fx: Effects = { ...p.effects, attrs: { ...p.effects.attrs } };
  if (p.category !== 'other') fx.attrs!.happiness = (fx.attrs!.happiness ?? 0) + personalityShift(s, p.category);
  const deltas = applyEffects(s, fx, rng, { label: p.title, txCat: TX_CAT_OF[p.category], trusted: false, fatigue });
  deltas.ap = -p.apCost;
  deltas.money -= p.moneyCost;
  let out = p.narrative;
  if (fatigue) out += ' 同类活动做得太多，收效递减。';
  const evt = p.category !== 'other' && maybeTrigger(s, EVENT_CAT_OF[p.category], 0.1, rng);
  if (evt) out += ' …… 突然发生了一件事。';
  addLog(s, 'action', p.title, out, 1);
  return finalize(s, { ok: true, title: p.title, text: out, deltas, eventTriggered: evt });
}

// ===================== NPC 互动 =====================
const KIND_MEMORY: Record<InteractionKind, string> = {
  chat: '聊了聊近况', meal: '一起吃了顿饭', exercise: '一起运动', gift: '收到了你的礼物', confide: '你向 TA 倾诉了心事', help: '你向 TA 请教了问题', borrow: '你向 TA 借了钱',
};

export function interactionBlockReason(s: GameState, npc: NPC, kind: InteractionKind): string | null {
  const it = INTERACTIONS.find((i) => i.id === kind)!;
  if (!npc.met) return '你还不认识这个人。';
  if (npc.affinity < it.minAffinity) return `好感度不足（需要 ≥ ${it.minAffinity}）。`;
  if (kind === 'borrow' && s.flags[`loan_${npc.id}`] !== undefined) return '你还欠着对方的钱，先还了再说。';
  return guard(s, it.ap, it.money);
}

export function interactWithNpc(input: GameState, npcId: string, kind: InteractionKind, rng: RNG = Math.random): EngineResult {
  const npc0 = input.npcs.find((n) => n.id === npcId);
  const it = INTERACTIONS.find((i) => i.id === kind);
  if (!npc0 || !it) return fail(input, '无效的互动。');
  const reason = interactionBlockReason(input, npc0, kind);
  if (reason) return fail(input, reason);
  const s = clone(input);
  const n = s.npcs.find((x) => x.id === npcId)!;
  s.ap -= it.ap;
  s.stats.actionsDone++;
  if (it.money) { s.player.money -= it.money; addTx(s, -it.money, kind === 'gift' ? '礼物' : '社交', `${it.label}：${n.name}`); }
  const intro = it.intro.replace('{name}', n.name);

  if (n.mood === 'busy' && kind !== 'gift' && rng() < 0.4) {
    const text = `${intro}\n${n.name}：「抱歉，我现在忙得脱不开身，改天吧！」`;
    const deltas = emptyDeltas();
    deltas.ap = -it.ap;
    n.lastContactDay = s.day;
    addLog(s, 'social', `${n.name}正忙`, text, 1);
    return finalize(s, { ok: true, title: `${n.name}正忙`, text, deltas });
  }

  let score = it.base + MOOD_BONUS[n.mood];
  let traitBonus = 0;
  for (const t of n.traits) traitBonus += KIND_TRAIT_BONUS[kind][t] ?? 0;
  score += clamp(traitBonus, -3, 3);
  score += Math.floor((s.player.attrs.charm + s.player.attrs.eq - 80) / 30);
  score += Math.floor(rng() * 4) - 1;
  const talks = n.todayTalks ?? 0;
  n.todayTalks = talks + 1;
  if (score > 0 && talks >= 1) score *= talks === 1 ? 0.5 : 0.2; // 一天内反复找同一个人，收益递减
  if (kind === 'borrow') {
    const ok = rng() < clamp((n.affinity - 35) / 40, 0.3, 0.95);
    score = ok ? -4 : -3;
  }
  let aff = clamp(Math.round(score), -10, 12);
  if (aff > 0 && hasAsset(s, 'phone')) aff = Math.min(12, Math.round(aff * 1.1));
  const tone: 'good' | 'ok' | 'bad' = kind === 'borrow' ? (score === -4 ? 'good' : 'bad') : aff >= 3 ? 'good' : aff <= 0 ? 'bad' : 'ok';

  const fx: Effects = { attrs: { ...it.self }, npc: [{ id: n.id, affinity: aff, memory: `${KIND_MEMORY[kind]}，${tone === 'good' ? '对方很开心' : tone === 'bad' ? '反应有些冷淡' : '气氛平和'}。`, mood: tone === 'good' ? 'happy' : tone === 'bad' ? 'sad' : undefined }] };
  let extra = '';
  if (kind === 'help' && tone !== 'bad') {
    const h = HELP_BY_RELATION[n.relation];
    fx.attrs = { ...fx.attrs, ...h.effects.attrs };
    fx.knowledge = h.effects.knowledge;
    extra = h.text;
  } else if (kind === 'help') extra = '对方心不在焉，没怎么帮上忙。';
  if (kind === 'borrow') {
    if (tone === 'good') { fx.money = 500; fx.flags = { [`loan_${n.id}`]: s.day + 30 }; extra = `${n.name}借给了你 ¥500，约定 30 天后归还。`; }
    else extra = `${n.name}面露难色，婉拒了你。`;
  }
  const deltas = applyEffects(s, fx, rng, { label: `向${n.name}借钱`, txCat: '借还', trusted: true });
  deltas.ap = -it.ap;
  deltas.money -= it.money;
  // 信任与关系阶段：信任来自「好结果」，与好感分离；阶段永远由好感阈值推导
  const trustGain = tone === 'good' ? (kind === 'confide' || kind === 'help' ? 2 : 1) : tone === 'bad' ? -1 : 0;
  n.trust = clamp(n.trust + trustGain, -100, 100);
  const prevStage = n.stage;
  n.stage = stageForAffinity(n.affinity);
  let stageText = '';
  if (n.stage !== prevStage) {
    const order: RelationStage[] = ['stranger', 'acquaintance', 'friend', 'close', 'best'];
    const up = order.indexOf(n.stage) > order.indexOf(prevStage);
    stageText = up ? `你们的关系更进一步：${STAGE_META[n.stage].label}。` : `你们的关系变淡了：${STAGE_META[n.stage].label}。`;
    addLog(s, 'social', up ? `关系升温：${n.name}` : `关系降温：${n.name}`, stageText, 2);
  }
  const text = `${intro}\n${n.name}：「${dialogueLine(n.traits, tone, rng)}」${extra ? `\n${extra}` : ''}${stageText ? `\n${stageText}` : ''}`;
  const evt = maybeTrigger(s, 'social', 0.1, rng);
  addLog(s, 'social', `${it.label}：${n.name}`, text.replace('\n', ' '), 1);
  return finalize(s, { ok: true, title: `与${n.name}${it.label}`, text: evt ? `${text}\n……话音刚落，发生了一件事。` : text, deltas, eventTriggered: evt });
}

// ===================== 恋爱线（第三阶段） =====================
/** 恋爱关系只读摘要（UI 用） */
export function relationshipStatus(s: GameState, npcId: string): {
  stage: RelationStage; stageLabel: string; trust: number; partner: boolean; partnerDay: number | null; canConfess: boolean; romanceable: boolean;
} {
  const n = s.npcs.find((x) => x.id === npcId);
  if (!n) return { stage: 'stranger', stageLabel: '陌生', trust: 0, partner: false, partnerDay: null, canConfess: false, romanceable: false };
  const partnerDay = typeof s.flags[`partner_${npcId}`] === 'number' ? (s.flags[`partner_${npcId}`] as number) : null;
  return {
    stage: n.stage, stageLabel: STAGE_META[n.stage].label, trust: n.trust, partner: partnerDay !== null,
    partnerDay, canConfess: !!n.romanceable && partnerDay === null && n.affinity >= 50, romanceable: !!n.romanceable,
  };
}

/**
 * 表白：好感 ≥ 50 且对方可发展恋爱线时开放。
 * 成功率 = 0.3 + (好感-50)/100 + 魅力/300 + 信任/400，夹在 20%~92%。
 */
export function confess(input: GameState, npcId: string, rng: RNG = Math.random): EngineResult {
  const npc0 = input.npcs.find((n) => n.id === npcId);
  if (!npc0 || !npc0.met) return fail(input, '你还不认识这个人。', '表白失败');
  if (!npc0.romanceable) return fail(input, '你们之间更像是朋友或家人，不适合表白。', '表白失败');
  if (input.flags[`partner_${npcId}`] !== undefined) return fail(input, '你们已经在一起了。', '表白失败');
  if (npc0.affinity < 50) return fail(input, `好感还不够（需要 ≥ 50，现在是 ${Math.round(npc0.affinity)}）。先多相处一段时间吧。`, '表白失败');
  const g = guard(input, 2);
  if (g) return fail(input, g, '表白失败');
  const s = clone(input);
  s.ap -= 2;
  s.stats.actionsDone++;
  const n = s.npcs.find((x) => x.id === npcId)!;
  const chance = clamp(0.3 + (n.affinity - 50) / 100 + s.player.attrs.charm / 300 + n.trust / 400, 0.2, 0.92);
  const deltas = emptyDeltas();
  deltas.ap = -2;
  if (rng() < chance) {
    s.flags[`partner_${npcId}`] = s.day;
    n.affinity = clamp(n.affinity + 8, -100, 100);
    n.trust = clamp(n.trust + 10, -100, 100);
    n.mood = 'happy';
    n.stage = stageForAffinity(n.affinity);
    addMemory(n, s.day, '你表白了，TA 答应了。', 'good');
    const fx = applyEffects(s, { attrs: { happiness: 10, charm: 1 } }, rng, { label: '表白成功', txCat: '其他', trusted: true });
    deltas.attrs = fx.attrs;
    deltas.money = fx.money;
    deltas.knowledge = fx.knowledge;
    deltas.npc = fx.npc;
    addLog(s, 'social', '表白成功', `${n.name}答应了你的表白，你们在一起了。`, 3);
    return finalize(s, { ok: true, title: '表白成功', text: `${n.name}红着脸点了头。从今天起，你们是恋人了。`, deltas });
  }
  n.affinity = clamp(n.affinity - 6, -100, 100);
  n.stage = stageForAffinity(n.affinity);
  n.mood = 'sad';
  addMemory(n, s.day, '你表白了，TA 婉拒了。', 'bad');
  const fx = applyEffects(s, { attrs: { happiness: -5, eq: 1 } }, rng, { label: '表白被拒', txCat: '其他', trusted: true });
  deltas.attrs = fx.attrs;
  deltas.money = fx.money;
  deltas.knowledge = fx.knowledge;
  deltas.npc = fx.npc;
  addLog(s, 'social', '表白被拒', `${n.name}轻轻摇了摇头，说还需要一点时间。`, 2);
  return finalize(s, { ok: true, title: '表白未成功', text: `${n.name}愣了一下，把话题岔开了。至少你说出了口，也不算遗憾。`, deltas });
}

// ===================== 事件选择 =====================
export function choiceBlockReason(s: GameState, choiceId: string): string | null {
  const ev = s.pendingEvent;
  const ch = ev?.choices.find((c) => c.id === choiceId);
  if (!ev || !ch) return '没有这个选项。';
  if (ch.cost && ch.cost > s.player.money) return `需要 ¥${ch.cost}，你的钱不够。`;
  if (ch.require && s.player.attrs[ch.require.attr] < ch.require.min) return '属性不足。';
  return null;
}

export function resolveEventChoice(input: GameState, choiceId: string, rng: RNG = Math.random): EngineResult {
  const ev = input.pendingEvent;
  if (!ev) return fail(input, '当前没有待处理的事件。');
  const reason = choiceBlockReason(input, choiceId);
  if (reason) return fail(input, reason);
  const ch = ev.choices.find((c) => c.id === choiceId)!;
  const s = clone(input);
  if (ch.cost) { s.player.money -= ch.cost; addTx(s, -ch.cost, '事件', ev.title); }
  let outcome: EventOutcome;
  if (ch.check && ch.outcomes.length >= 2) {
    outcome = rng() < checkChance(s.player.attrs[ch.check.attr], ch.check.target) ? ch.outcomes[0] : ch.outcomes[1];
  } else outcome = weightedPick(ch.outcomes, rng);
  const deltas = applyEffects(s, outcome.effects, rng, { label: ev.title, txCat: '事件', trusted: ev.source === 'local' });
  if (ch.cost) deltas.money -= ch.cost;
  // 开局选「直接进入社会 / 先出去走走」时，默认开始承担房租（否则新手期太宽松）
  if (ev.defId === 'opening' && s.player.occupation !== 'student' && s.player.housing === null) s.player.housing = 'shared';
  s.pendingEvent = null;
  s.seenEvents[ev.defId] = s.day;
  s.stats.eventsResolved++;
  addLog(s, 'event', ev.title, `选择「${ch.label}」：${outcome.text}`, ev.category === 'major' ? 3 : 2);
  recordStoryFact(s, ev, ch.label, outcome.text);
  return finalize(s, { ok: true, title: ev.title, text: outcome.text, deltas });
}

// ===================== AI 增强层：事件注入 / 台词替换 / 预算熔断 / 剧情线 =====================
/** 每个游戏日最多调用 AI 的次数（预算上限） */
export const AI_DAILY_LIMIT = 3;
/** 连续失败多少次触发熔断 */
export const AI_MAX_FAILURES = 3;
/** 熔断持续时间（毫秒） */
export const AI_COOLDOWN_MS = 5 * 60 * 1000;
/** 剧情线最多保留条数 */
export const MAX_STORY_THREADS = 6;

/** 台词/摘要里不允许出现「好感 +5」这类数值断言：数值只能由引擎产生 */
const NUMERIC_CLAIM = /(好感|属性|智力|情商|体能|魅力|幸福|健康|金钱|财富|行动点)\s*[+＋\-－]?\s*\d/;

/** 今日已用的 AI 调用次数（跨天自动归零，只读） */
export function aiCallsToday(s: GameState): number {
  return s.ai.day === s.day ? s.ai.calls : 0;
}

/** 现在是否还能调用 AI（预算 + 熔断时间窗） */
export function canCallAi(s: GameState, now = Date.now()): boolean {
  return aiCallsToday(s) < AI_DAILY_LIMIT && s.ai.cooldownUntil <= now;
}

/** AI 熔断剩余毫秒数（0 表示未熔断） */
export function aiCooldownLeft(s: GameState, now = Date.now()): number {
  return Math.max(0, s.ai.cooldownUntil - now);
}

/**
 * 注入一个已经过校验的事件（AI 清晨事件等）。
 * 乐观并发：必须「当前没有待处理事件」且日期未变化，避免 AI 慢返回污染已经过去的日子。
 */
export function injectEvent(input: GameState, event: GameEvent, expectedDay = input.day): EngineResult {
  if (input.pendingEvent) return fail(input, '已经有一件事在等你了。', '事件未能注入');
  if (input.day !== expectedDay || event.day !== input.day) return fail(input, '时间已经变了，这个事件不再适用。', '事件未能注入');
  if (!event.choices.length) return fail(input, '这个事件没有任何选项。', '事件未能注入');
  if (!event.choices.some((c) => !c.cost || c.cost <= input.player.money)) {
    return fail(input, '事件的所有选项都需要花钱，而你现在付不起。', '事件未能注入');
  }
  const s = clone(input);
  s.pendingEvent = event;
  addLog(s, 'event', event.title, event.description.slice(0, 120), event.category === 'major' ? 3 : 2);
  return finalize(s, { ok: true, title: event.title, text: event.description, deltas: emptyDeltas(), eventTriggered: true });
}

/**
 * 用 AI 台词替换最近一条与该 NPC 的互动文案（只改文案与记忆，**不改任何数值**）。
 * 台词长度 ≤60 字，过滤换行/引号，含数值描述的直接丢弃。
 */
export function rewriteNpcLine(input: GameState, npcId: string, rawLine: string): EngineResult {
  const target = input.npcs.find((n) => n.id === npcId);
  if (!target || !target.met) return fail(input, '你还不认识这个人。', '台词未能替换');
  const line = String(rawLine ?? '').replace(/[\r\n\t「」"“”']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!line) return fail(input, '台词是空的。', '台词未能替换');
  if (NUMERIC_CLAIM.test(line)) return fail(input, '台词里出现了数值描述，已丢弃。', '台词未能替换');
  const s = clone(input);
  const n = s.npcs.find((x) => x.id === npcId)!;
  const log = [...s.log].reverse().find((l) => l.kind === 'social' && l.title.includes(n.name));
  if (!log) return fail(input, '没有找到可以替换的互动记录。', '台词未能替换');
  const quoted = log.text.match(/「[^」]*」/);
  log.text = quoted ? log.text.replace(quoted[0], `「${line}」`) : `${log.text} ${n.name}：「${line}」`;
  addMemory(n, s.day, `TA 说：「${line}」`, 'neutral');
  s.updatedAt = Date.now();
  return { state: s, result: { ok: true, title: `${n.name}说的话`, text: line, deltas: emptyDeltas() } };
}

/** 记录一次 AI 调用：跨天重置计数；只有成功调用才占用当日预算，连续失败达到阈值时熔断 */
export function recordAiCall(input: GameState, ok: boolean, now = Date.now()): EngineResult {
  const s = clone(input);
  if (s.ai.day !== s.day) { s.ai.day = s.day; s.ai.calls = 0; }
  if (ok) {
    s.ai.calls += 1;
    s.ai.failures = 0;
  } else {
    s.ai.failures += 1;
    if (s.ai.failures >= AI_MAX_FAILURES) {
      s.ai.cooldownUntil = now + AI_COOLDOWN_MS;
      s.ai.failures = 0;
    }
  }
  s.updatedAt = now;
  return { state: s, result: { ok: true, title: 'AI 状态', text: ok ? 'AI 调用成功' : 'AI 调用失败', deltas: emptyDeltas() } };
}

/** 写入 NPC 记忆摘要（≥30 条记忆时压缩最早的一批并删除），只由校验后的 AI 结果调用 */
export function applyNpcSummary(input: GameState, npcId: string, rawSummary: string, drop = 20): EngineResult {
  const target = input.npcs.find((n) => n.id === npcId && n.met);
  if (!target) return fail(input, '你还不认识这个人。', '摘要未能写入');
  const summary = String(rawSummary ?? '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!summary) return fail(input, '摘要内容为空。', '摘要未能写入');
  if (NUMERIC_CLAIM.test(summary)) return fail(input, '摘要里出现了数值描述，已丢弃。', '摘要未能写入');
  const s = clone(input);
  const n = s.npcs.find((x) => x.id === npcId)!;
  n.summary = summary;
  if (n.memories.length >= 30) n.memories.splice(0, Math.min(drop, n.memories.length - 10));
  s.updatedAt = Date.now();
  return { state: s, result: { ok: true, title: `${n.name}的近况`, text: summary, deltas: emptyDeltas() } };
}

/** 结束一条剧情线（AI 可提议，必须走这里才生效） */
export function closeStoryThread(input: GameState, threadId: string): EngineResult {
  const th = input.storyThreads.find((t) => t.id === threadId);
  if (!th) return fail(input, '没有这条剧情线。', '剧情线未能关闭');
  const s = clone(input);
  const t = s.storyThreads.find((x) => x.id === threadId)!;
  t.status = 'closed';
  t.lastDay = s.day;
  s.updatedAt = Date.now();
  return { state: s, result: { ok: true, title: '剧情线结束', text: t.title, deltas: emptyDeltas() } };
}

/** 把「选择 → 结果」作为事实追加到剧情线（本地代码拼接，AI 只负责后续叙述） */
function recordStoryFact(s: GameState, ev: GameEvent, choiceLabel: string, outcomeText: string) {
  if (ev.category !== 'major' && ev.source !== 'ai') return;
  const id = `th_${ev.defId}`;
  const fact = `第${s.day}天：「${choiceLabel}」→ ${outcomeText.slice(0, 60)}`;
  let th = s.storyThreads.find((t) => t.id === id);
  if (!th) {
    th = {
      id, title: ev.title.slice(0, 30), summary: '', openedDay: s.day, lastDay: s.day, status: 'open',
      npcIds: ev.npcId ? [ev.npcId] : [],
    };
    s.storyThreads.push(th);
    if (s.storyThreads.length > MAX_STORY_THREADS) {
      const closed = s.storyThreads.filter((t) => t.status === 'closed').sort((a, b) => a.lastDay - b.lastDay)[0];
      const drop = closed ?? [...s.storyThreads].sort((a, b) => a.lastDay - b.lastDay)[0];
      s.storyThreads = s.storyThreads.filter((t) => t !== drop);
    }
  }
  th.summary = `${th.summary}${th.summary ? '；' : ''}${fact}`.slice(-300);
  th.lastDay = s.day;
}

// ===================== 经济：储蓄 / 理财（第三阶段） =====================
/** 转账类操作：至少 ¥100，单笔上限 ¥500,000，且必须是整数 */
function checkAmount(input: GameState, amount: number, noun: string): string | null {
  const a = Math.round(Number(amount));
  if (!Number.isFinite(a) || a < INVEST_MIN) return `单次${noun}至少 ¥${INVEST_MIN}。`;
  if (a > INVEST_MAX) return `单次${noun}最多 ¥${INVEST_MAX.toLocaleString('zh-CN')}。`;
  return null;
}

export function deposit(input: GameState, amount: number): EngineResult {
  const bad = checkAmount(input, amount, '存入');
  if (bad) return fail(input, bad, '存款失败');
  const a = Math.round(amount);
  if (a > input.player.money) return fail(input, `现金不足：你现在有 ¥${Math.max(0, Math.round(input.player.money))}。`, '存款失败');
  const s = clone(input);
  s.player.money -= a;
  s.player.savings += a;
  addTx(s, -a, '其他', '转入储蓄');
  addLog(s, 'finance', '存入储蓄', `你把 ¥${a.toLocaleString('zh-CN')} 转进了储蓄账户。`, 1);
  return finalize(s, { ok: true, title: '存入储蓄', text: `已存入 ¥${a.toLocaleString('zh-CN')}，储蓄余额 ¥${Math.round(s.player.savings).toLocaleString('zh-CN')}。`, deltas: { ...emptyDeltas(), money: -a } });
}

export function withdraw(input: GameState, amount: number): EngineResult {
  const bad = checkAmount(input, amount, '取出');
  if (bad) return fail(input, bad, '取款失败');
  const a = Math.round(amount);
  if (a > input.player.savings) return fail(input, `储蓄里只有 ¥${Math.round(input.player.savings).toLocaleString('zh-CN')}。`, '取款失败');
  const s = clone(input);
  s.player.savings -= a;
  s.player.money += a;
  addTx(s, a, '其他', '储蓄取现');
  addLog(s, 'finance', '取出储蓄', `你从储蓄里取出 ¥${a.toLocaleString('zh-CN')}。`, 1);
  return finalize(s, { ok: true, title: '取出储蓄', text: `已取出 ¥${a.toLocaleString('zh-CN')}，现金 ¥${Math.round(s.player.money).toLocaleString('zh-CN')}。`, deltas: { ...emptyDeltas(), money: a } });
}

export function buyInvestment(input: GameState, product: InvestmentProduct, amount: number): EngineResult {
  const def = getInvestmentProduct(product);
  if (!def) return fail(input, '没有这个理财产品。', '买入失败');
  const bad = checkAmount(input, amount, '买入');
  if (bad) return fail(input, bad, '买入失败');
  const a = Math.round(amount);
  if (a > input.player.money) return fail(input, `现金不足：你现在有 ¥${Math.max(0, Math.round(input.player.money))}。`, '买入失败');
  const s = clone(input);
  s.player.money -= a;
  s.player.investments.push({ id: uid('inv'), product: def.id, principal: a, value: a, openedDay: s.day });
  addTx(s, -a, '其他', `买入${def.name}`);
  addLog(s, 'finance', `买入${def.name}`, `投入 ¥${a.toLocaleString('zh-CN')} 买入${def.name}（${def.risk}风险）。`, 2);
  return finalize(s, { ok: true, title: `买入${def.name}`, text: `投入 ¥${a.toLocaleString('zh-CN')}。每月初结算收益，风险：${def.risk}。`, deltas: { ...emptyDeltas(), money: -a } });
}

export function sellInvestment(input: GameState, investmentId: string): EngineResult {
  const inv = input.player.investments.find((i) => i.id === investmentId);
  if (!inv) return fail(input, '没有这笔持仓。', '卖出失败');
  const s = clone(input);
  const target = s.player.investments.find((i) => i.id === investmentId)!;
  const def = getInvestmentProduct(target.product);
  const value = Math.max(0, Math.round(target.value));
  s.player.money += value;
  s.player.investments = s.player.investments.filter((i) => i.id !== investmentId);
  addTx(s, value, '其他', `卖出${def?.name ?? '理财'}`);
  const gain = value - target.principal;
  const prevProfit = typeof s.flags.investProfit === 'number' ? s.flags.investProfit : 0;
  s.flags.investProfit = prevProfit + gain;
  addLog(s, 'finance', '卖出理财', `卖出「${def?.name ?? '理财'}」，回款 ¥${value.toLocaleString('zh-CN')}，${gain >= 0 ? `赚了 ¥${gain.toLocaleString('zh-CN')}` : `亏了 ¥${(-gain).toLocaleString('zh-CN')}`}。`, 1);
  return finalize(s, {
    ok: true, title: `卖出${def?.name ?? '理财'}`,
    text: `回款 ¥${value.toLocaleString('zh-CN')}，${gain >= 0 ? `盈利 ¥${gain.toLocaleString('zh-CN')}` : `亏损 ¥${(-gain).toLocaleString('zh-CN')}`}。`,
    deltas: { ...emptyDeltas(), money: value },
  });
}

// ===================== 资产（3.1.5） =====================
/** 是否拥有某件资产 */
export const hasAsset = (s: GameState, assetId: string) => s.player.assets.includes(assetId);

export function buyAsset(input: GameState, assetId: string): EngineResult {
  const def = getAssetById(assetId);
  if (!def) return fail(input, '没有这个资产。', '购买失败');
  if (input.player.assets.includes(assetId)) return fail(input, `你已经拥有「${def.name}」了。`, '购买失败');
  if (input.player.money < def.price) {
    return fail(input, `钱不够：需要 ¥${def.price.toLocaleString('zh-CN')}，你只有 ¥${Math.max(0, Math.round(input.player.money)).toLocaleString('zh-CN')}。`, '购买失败');
  }
  const s = clone(input);
  s.player.money -= def.price;
  s.player.assets.push(def.id);
  addTx(s, -def.price, '其他', `购买${def.name}`);
  addLog(s, 'finance', `购买${def.name}`, def.desc, 2);
  return finalize(s, { ok: true, title: `购买${def.name}`, text: `你买下了${def.name}。${def.desc}`, deltas: { ...emptyDeltas(), money: -def.price } });
}

// ===================== 居住（3.1.6） =====================
/**
 * 搬家/租房：一次性押金与搬家费，之后每月初自动扣房租。
 * 舒适度影响睡眠恢复（health/happiness 恢复倍率 0.7~1.4），是「多花钱换状态」的权衡。
 */
export function changeHousing(input: GameState, to: HousingId | null): EngineResult {
  if (input.pendingEvent) return fail(input, '眼前有一件事需要你先做决定。', '搬家失败');
  if (input.player.housing === to) return fail(input, '你现在就住在这里。', '搬家失败');
  if (to !== null && !getHousingById(to)) return fail(input, '没有这种居住方式。', '搬家失败');
  const cost = moveCostOf(to);
  if (input.player.money < cost) {
    return fail(input, `搬家需要 ¥${cost.toLocaleString('zh-CN')}（押金/搬家费），你只有 ¥${Math.max(0, Math.round(input.player.money)).toLocaleString('zh-CN')}。`, '搬家失败');
  }
  const s = clone(input);
  s.player.money -= cost;
  s.player.housing = to;
  const home = housingOf(to);
  addTx(s, -cost, '房租', to ? `搬入${home.name}（押金/搬家费）` : '搬回家里');
  addLog(s, 'finance', to ? `搬入${home.name}` : '搬回家里', `${home.desc}月租 ¥${home.rent}，舒适度 ${home.comfort}。`, 2);
  return finalize(s, {
    ok: true, title: to ? '搬家' : '搬回家里',
    text: `你${to ? `搬进了${home.name}` : '搬回了家里'}。月租 ¥${home.rent.toLocaleString('zh-CN')}，舒适度 ${home.comfort}/100。`,
    deltas: { ...emptyDeltas(), money: -cost },
  });
}

// ===================== 银行贷款（3.1.4 信用分实装） =====================
/** 当前可贷额度：受信用分限制，信用分过低不放贷 */
export function loanLimit(s: GameState): number {
  if (s.player.credit < LOAN_MIN_CREDIT) return 0;
  return clamp(Math.round((s.player.credit - 500) * LOAN_LIMIT_FACTOR), 0, LOAN_MAX);
}

/** 年化利率：信用越高越低（约 6%~18%） */
export function bankLoanRate(s: GameState): number {
  return clamp(0.18 - (s.player.credit - LOAN_MIN_CREDIT) / 4000, 0.06, 0.18);
}

export function takeBankLoan(input: GameState, amount: number): EngineResult {
  if (input.pendingEvent) return fail(input, '眼前有一件事需要你先做决定。', '贷款失败');
  if (input.player.bankLoan) return fail(input, `你还有一笔 ¥${input.player.bankLoan.remaining.toLocaleString('zh-CN')} 的贷款没还清。`, '贷款失败');
  const limit = loanLimit(input);
  if (input.player.credit < LOAN_MIN_CREDIT) return fail(input, `信用分 ${Math.round(input.player.credit)} 低于 ${LOAN_MIN_CREDIT}，银行不予放贷。`, '贷款失败');
  const a = Math.round(Number(amount));
  if (!Number.isFinite(a) || a < LOAN_MIN) return fail(input, `单次贷款至少 ¥${LOAN_MIN.toLocaleString('zh-CN')}。`, '贷款失败');
  if (a > limit) return fail(input, `超出可贷额度：你的额度是 ¥${limit.toLocaleString('zh-CN')}（信用分 ${Math.round(input.player.credit)}）。`, '贷款失败');
  const rate = bankLoanRate(input);
  const total = Math.round(a * (1 + rate));
  const s = clone(input);
  s.player.money += a;
  s.player.bankLoan = { amount: a, remaining: total, monthly: Math.ceil(total / LOAN_TERM), rate, startedDay: s.day };
  s.player.credit = clamp(s.player.credit - 8, 300, 850);
  s.flags.loansTaken = (typeof s.flags.loansTaken === 'number' ? s.flags.loansTaken : 0) + 1;
  addTx(s, a, '借还', '银行贷款');
  addLog(s, 'finance', '银行贷款', `你向银行借入 ¥${a.toLocaleString('zh-CN')}，年利率 ${(rate * 100).toFixed(1)}%，分 ${LOAN_TERM} 期还款。`, 2);
  return finalize(s, {
    ok: true, title: '贷款到账',
    text: `¥${a.toLocaleString('zh-CN')} 已到账。年利率 ${(rate * 100).toFixed(1)}%，每月应还 ¥${Math.ceil(total / LOAN_TERM).toLocaleString('zh-CN')}（共 ${LOAN_TERM} 期）。`,
    deltas: { ...emptyDeltas(), money: a },
  });
}

export function repayBankLoan(input: GameState, amount: number): EngineResult {
  const loan = input.player.bankLoan;
  if (!loan) return fail(input, '你现在没有银行贷款。', '还款失败');
  const a = Math.round(Number(amount));
  if (!Number.isFinite(a) || a <= 0) return fail(input, '还款金额必须是正整数。', '还款失败');
  if (a > loan.remaining) return fail(input, `你只剩 ¥${loan.remaining.toLocaleString('zh-CN')} 未还。`, '还款失败');
  if (a > input.player.money) return fail(input, `现金不足：你现在有 ¥${Math.max(0, Math.round(input.player.money)).toLocaleString('zh-CN')}。`, '还款失败');
  const s = clone(input);
  const l = s.player.bankLoan!;
  s.player.money -= a;
  l.remaining -= a;
  addTx(s, -a, '借还', '提前还贷');
  let text: string;
  if (l.remaining <= 0) {
    s.player.bankLoan = null;
    s.player.credit = clamp(s.player.credit + 25, 300, 850);
    s.flags.loansCleared = (typeof s.flags.loansCleared === 'number' ? s.flags.loansCleared : 0) + 1;
    addLog(s, 'finance', '贷款已结清', '你提前还清了银行贷款，信用分提升。', 2);
    text = `你提前还清了整笔贷款，信用分 +25。`;
  } else {
    s.player.credit = clamp(s.player.credit + 2, 300, 850);
    text = `已还款 ¥${a.toLocaleString('zh-CN')}，剩余 ¥${l.remaining.toLocaleString('zh-CN')}。`;
  }
  return finalize(s, { ok: true, title: '还贷', text, deltas: { ...emptyDeltas(), money: -a } });
}

/** 每月初自动扣款：现金不足视为逾期，扣信用分 */
function settleBankLoan(s: GameState, report: string[]) {
  const loan = s.player.bankLoan;
  if (!loan) return;
  const pay = Math.min(loan.monthly, loan.remaining);
  s.player.money -= pay;
  loan.remaining -= pay;
  addTx(s, -pay, '借还', '银行贷款还款');
  if (loan.remaining <= 0) {
    s.player.bankLoan = null;
    s.player.credit = clamp(s.player.credit + 25, 300, 850);
    s.flags.loansCleared = (typeof s.flags.loansCleared === 'number' ? s.flags.loansCleared : 0) + 1;
    report.push(`🏦 银行贷款已全部结清，信用分提升（当前 ${Math.round(s.player.credit)}）。`);
    addLog(s, 'finance', '贷款已结清', '最后一期贷款还完，你松了口气。', 2);
  } else if (s.player.money < 0) {
    s.player.credit = clamp(s.player.credit - 15, 300, 850);
    report.push(`⚠️ 现金不足，本月贷款逾期，信用分下降（当前 ${Math.round(s.player.credit)}）。`);
    addLog(s, 'finance', '贷款逾期', '你没能按时还款，银行发来了催收短信。', 2);
  } else {
    s.player.credit = clamp(s.player.credit + 1, 300, 850);
    report.push(`🏦 本月房贷 / 贷款还款 ¥${pay.toLocaleString('zh-CN')} 已扣除，剩余 ${LOAN_TERM - Math.ceil(loan.remaining / loan.monthly)} 期左右。`);
  }
}

/** 每月初：储蓄计息 + 理财按产品参数波动结算（rng 可复现） */
function settleEconomy(s: GameState, rng: RNG, report: string[]) {
  const interest = Math.round(s.player.savings * (SAVINGS_ANNUAL_RATE / 12));
  if (interest > 0) {
    s.player.savings += interest;
    report.push(`🏦 储蓄利息 ¥${interest} 已入账（储蓄 ¥${Math.round(s.player.savings).toLocaleString('zh-CN')}）。`);
    addLog(s, 'finance', '储蓄利息', `本月储蓄利息 ¥${interest}。`, 1);
  }
  const lines: string[] = [];
  for (const inv of s.player.investments) {
    const def = getInvestmentProduct(inv.product);
    if (!def) continue;
    const rate = def.meanRate + (rng() * 2 - 1) * def.vol;
    const before = inv.value;
    inv.value = Math.max(0, Math.round(inv.value * (1 + rate)));
    inv.lastRate = Math.round(rate * 1000) / 10;
    const delta = inv.value - before;
    lines.push(`${def.name} ${delta >= 0 ? '+' : ''}¥${delta}（${inv.lastRate.toFixed(1)}%）`);
  }
  if (lines.length) {
    report.push(`📈 理财月结：${lines.slice(0, 3).join('、')}${lines.length > 3 ? ' 等' : ''}。`);
    addLog(s, 'finance', '理财月结', lines.join('；'), 1);
  }
}

// ===================== 结束一天 =====================
const MOOD_WEIGHTS: Record<Mood, number> = { happy: 3, neutral: 4, sad: 1.5, angry: 0.7, busy: 2, excited: 1 };
function pickMood(n: NPC, rng: RNG): Mood {
  const items = (Object.keys(MOOD_WEIGHTS) as Mood[]).map((m) => {
    let w = MOOD_WEIGHTS[m];
    if (n.traits.includes('外向') && (m === 'happy' || m === 'excited')) w *= 1.5;
    if ((n.traits.includes('内向') || n.traits.includes('感性')) && m === 'sad') w *= 1.5;
    if (n.traits.includes('严肃') && (m === 'angry' || m === 'busy')) w *= 1.5;
    if (n.traits.includes('温和') && m === 'angry') w *= 0.4;
    return { weight: w, mood: m };
  });
  return weightedPick(items, rng).mood;
}

function tickNpcs(s: GameState, rng: RNG, report: string[]) {
  let reached = false;
  for (const n of s.npcs) {
    n.todayTalks = 0;
    if (rng() < 0.22) n.mood = pickMood(n, rng);
    n.status = pick(STATUS_POOL[n.relation], rng);
    if (!n.met) continue;
    // 恋爱线：好感跌到冰点会分手
    if (s.flags[`partner_${n.id}`] !== undefined && n.affinity < 15) {
      delete s.flags[`partner_${n.id}`];
      s.flags.breakups = (typeof s.flags.breakups === 'number' ? s.flags.breakups : 0) + 1;
      addMemory(n, s.day, '你们分手了。', 'bad');
      applyEffects(s, { attrs: { happiness: -10 } }, rng, { label: '分手', txCat: '其他', trusted: true });
      report.push(`💔 你和${n.name}分开了，这段感情结束了。`);
      addLog(s, 'social', `分手：${n.name}`, '关系冷到冰点，你们结束了这段感情。', 3);
    }
    // 阶段随好感变化自动重算（自然衰减后也可能降级）
    n.stage = stageForAffinity(n.affinity);
    n.trust = clamp(n.trust, -100, 100);
    const gap = s.day - n.lastContactDay;
    if (n.relation !== 'family' && gap > 14 && gap % 7 === 0 && n.affinity > 0) n.affinity -= 1;
    const lastReach = typeof s.flags[`reach_${n.id}`] === 'number' ? (s.flags[`reach_${n.id}`] as number) : -99;
    if (!reached && n.affinity >= 25 && gap >= 6 && s.day - lastReach > 8 && rng() < 0.15) {
      reached = true;
      s.flags[`reach_${n.id}`] = s.day;
      const line = pick(REACH_LINES, rng);
      addMemory(n, s.day, `主动联系了你：「${line}」`, 'good');
      report.push(`${n.avatar} ${n.name}给你发来消息：「${line}」`);
      addLog(s, 'social', `${n.name}联系了你`, line, 1);
    }
  }
}

/** 睡眠恢复公式（居住舒适度影响倍率；导出让档案/UI 与测试共用同一套数值） */
export function sleepRecovery(s: GameState, leftoverAp: number): { health: number; happiness: number } {
  const comfort = housingOf(s.player.housing).comfort;
  const comfortMul = clamp(comfort / 60, 0.7, 1.4);
  return {
    health: (0.15 + leftoverAp * 0.12) * comfortMul,
    happiness: leftoverAp * 0.08 * comfortMul,
  };
}

export function endDay(input: GameState, rng: RNG = Math.random): EngineResult {
  if (input.pendingEvent) return fail(input, '还有一件事等你决定，先处理它吧。');
  const s = clone(input);
  const report: string[] = [];
  const leftover = s.ap;
  const opt = (label: string): ApplyOpts => ({ label, txCat: '其他', trusted: true });

  // ---- 当日结算 ----
  s.player.money -= LIVING_COST;
  addTx(s, -LIVING_COST, '生活', '日常开销');
  const recover = sleepRecovery(s, leftover); // 居住舒适度影响睡眠恢复
  applyEffects(s, { attrs: recover }, rng, opt('睡眠恢复'));
  if (!s.todayCounts.exercise) applyEffects(s, { attrs: { fitness: -0.3 } }, rng, opt('缺乏锻炼'));
  if (s.player.money < 0) { applyEffects(s, { attrs: { happiness: -2 } }, rng, opt('债务压力')); report.push('💸 你还在负债，压力让你睡得不安稳。'); }
  if (s.player.attrs.health < 30) applyEffects(s, { attrs: { happiness: -1 } }, rng, opt('身体不适'));
  const h = s.player.attrs.happiness;
  if (h > 75) applyEffects(s, { attrs: { happiness: -0.5 } }, rng, opt('情绪回落'));
  else if (h < 35) applyEffects(s, { attrs: { happiness: 0.5 } }, rng, opt('情绪回升'));

  // ---- 进入新的一天 ----
  s.day += 1;
  s.ap = s.maxAp;
  s.todayCounts = {};
  delete s.flags.birthdayToday;
  const dp = getDate(s);
  const age = calcAge(s.player.birthISO, dp);

  // 人生阶段状态机：跨过年龄节点时写日志，并在 60 岁标记终局
  const stage = lifeStageFor(age);
  const prevStage = typeof s.flags.lifeStage === 'string' ? s.flags.lifeStage : null;
  if (prevStage !== stage.key) {
    s.flags.lifeStage = stage.key;
    report.push(`${stage.emoji} 你进入了「${stage.label}」：${stage.desc}`);
    addLog(s, 'system', `人生阶段：${stage.label}`, stage.desc, 3);
    if (stage.key === 'retire') {
      s.flags.lifeEnded = s.day;
      report.push(`🎬 你走到了第 ${RETIRE_AGE} 个年头，是时候回望这一生了。`);
      addLog(s, 'system', `人生走到第 ${RETIRE_AGE} 年`, '退休年龄到了，是时候回望这一生。', 3);
    }
  }

  if (isBirthday(s.player.birthISO, dp)) {
    s.flags.birthdayToday = true;
    report.push(`🎂 今天是你的生日，你${age}岁了。`);
    addLog(s, 'system', `${age}岁生日`, `你又长大了一岁，现在是 ${age} 岁。`, 3);
  }
  if (dp.d === 1) {
    const bg = BACKGROUNDS[s.player.background];
    if (s.player.occupation === 'student') {
      s.player.money += bg.allowance;
      addTx(s, bg.allowance, '津贴', '家庭津贴');
      report.push(`📬 家里寄来了本月津贴 ¥${bg.allowance}。`);
    }
    const home = housingOf(s.player.housing);
    if (home.rent > 0) {
      s.player.money -= home.rent;
      addTx(s, -home.rent, '房租', `房租：${home.name}`);
      report.push(`🏠 本月房租 ¥${home.rent.toLocaleString('zh-CN')} 已扣除（${home.name}）。`);
    }
    // 上月工资明细（税前 / 五险一金 / 个税 / 到手），然后清零重新累计
    if (s.player.monthGross > 0) {
      const net = s.player.monthGross - s.player.monthInsurance - s.player.monthTax;
      report.push(`💼 上月工资：税前 ¥${s.player.monthGross.toLocaleString('zh-CN')}，五险一金 ¥${s.player.monthInsurance.toLocaleString('zh-CN')}，个税 ¥${s.player.monthTax.toLocaleString('zh-CN')}，到手 ¥${net.toLocaleString('zh-CN')}。`);
      addLog(s, 'finance', '上月工资明细', `税前 ¥${s.player.monthGross}，五险一金 ¥${s.player.monthInsurance}，个税 ¥${s.player.monthTax}，到手 ¥${net}。`, 1);
      s.player.monthGross = 0;
      s.player.monthInsurance = 0;
      s.player.monthTax = 0;
    }
    reviewCareer(s, rng, report);
    settleBankLoan(s, report);
    settleEconomy(s, rng, report);
    // 跨年时标记一条「待查看的年度回顾」，由档案/首页弹窗展示后清除
    if (dp.m === 1 && dp.d === 1) s.flags.pendingReviewYear = dp.y - 1;
    addLog(s, 'finance', `${dp.m}月账单`, `进入 ${dp.y} 年 ${dp.m} 月，当前财富 ¥${Math.round(s.player.money)}。`, 1);
  }
  for (const [k, v] of Object.entries(s.flags)) {
    if (k.startsWith('loan_') && typeof v === 'number' && v <= s.day) {
      const npc = s.npcs.find((n) => `loan_${n.id}` === k);
      s.player.money -= 500;
      addTx(s, -500, '借还', `归还借款：${npc?.name ?? '朋友'}`);
      delete s.flags[k];
      if (npc) { npc.affinity = clamp(npc.affinity + 3, -100, 100); addMemory(npc, s.day, '你如期还了钱。', 'good'); }
      s.player.credit = clamp(s.player.credit + 2, 300, 850);
      report.push(`🤝 你归还了向${npc?.name ?? '朋友'}借的 ¥500。`);
    }
  }
  tickNpcs(s, rng, report);

  if (s.player.attrs.health <= 5) {
    s.player.money -= 1500;
    addTx(s, -1500, '医疗', '急诊住院');
    s.player.attrs.health = 30;
    s.ap = Math.floor(s.maxAp / 2);
    report.push('🚑 你因过度透支被送进医院，花了 ¥1,500，今天只剩一半精力。');
    addLog(s, 'system', '住院', '身体彻底罢工，你被送进了医院。', 3);
  }

  // ---- 清晨事件 ----
  const pri = EVENT_DEFS.filter((d) => d.priority && isEligible(d, s));
  for (const d of pri) { const ev = instantiateEvent(d, s, rng); if (ev) { s.pendingEvent = ev; break; } }
  if (!s.pendingEvent && rng() < 0.4) {
    const pool = EVENT_DEFS.filter((d) => !d.priority && d.weight > 0 && isEligible(d, s));
    if (pool.length) { const ev = instantiateEvent(weightedPick(pool, rng), s, rng); if (ev) s.pendingEvent = ev; }
  }
  if (s.pendingEvent) report.push(`⚡ 新的一天，有事发生：${s.pendingEvent.title}`);

  s.wealthHistory.push({ day: s.day, money: Math.round(s.player.money) });
  // 每周记录一次六维快照（档案里画属性变化曲线）
  if (s.day % 7 === 0) {
    const snapshot = { day: s.day, attrs: { ...s.player.attrs } };
    const last = s.attrHistory[s.attrHistory.length - 1];
    if (!last || last.day !== snapshot.day) {
      s.attrHistory.push(snapshot);
      if (s.attrHistory.length > 220) s.attrHistory.shift();
    }
  }
  s.morningReport = report;
  const deltas = diffDeltas(input, s);
  const text = `${formatDate(dp)}，新的一天开始了。${leftover > 0 ? `昨天剩下的 ${leftover} 点行动点化作了睡眠。` : '你昨天几乎榨干了所有精力。'}`;
  addLog(s, 'system', '新的一天', text, 1);
  return finalize(s, { ok: true, title: '新的一天', text, deltas, eventTriggered: !!s.pendingEvent });
}

// ===================== 档案：总结 =====================
/** 关闭「人生终局」提示（只是 UI 状态，不影响数值） */
export function dismissLifeEnd(input: GameState): EngineResult {
  if (typeof input.flags.lifeEnded !== 'number') return fail(input, '还没有走到终局。', '无需操作');
  if (input.flags.lifeEndedSeen === input.flags.lifeEnded) return fail(input, '终局总结已经看过了。', '无需操作');
  const s = clone(input);
  s.flags.lifeEndedSeen = s.flags.lifeEnded;
  s.updatedAt = Date.now();
  return { state: s, result: { ok: true, title: '人生终局', text: '已查看终局总结。', deltas: emptyDeltas() } };
}

/** 关闭「年度回顾」提示（只是 UI 状态，不影响数值） */
export function dismissYearReview(input: GameState): EngineResult {
  if (typeof input.flags.pendingReviewYear !== 'number') return fail(input, '没有待查看的年度回顾。', '无需操作');
  const s = clone(input);
  delete s.flags.pendingReviewYear;
  s.updatedAt = Date.now();
  return { state: s, result: { ok: true, title: '年度回顾', text: '已查看年度回顾。', deltas: emptyDeltas() } };
}
export function lifeSummary(s: GameState): { title: string; lines: string[] } {
  const a = s.player.attrs;
  const best = (Object.entries(a) as [keyof Attrs, number][]).reduce((x, y) => (y[1] > x[1] ? y : x));
  const titles: Record<keyof Attrs, string> = { intelligence: '学者型', eq: '知心人', fitness: '行动派', charm: '焦点人物', happiness: '乐天派', health: '养生达人' };
  const title = `${titles[best[0]]}·${s.player.name}`;
  const job = getJob(s);
  const closest = [...s.npcs].filter((n) => n.met).sort((x, y) => y.affinity - x.affinity)[0];
  const skills = (Object.entries(s.player.skills) as [SkillKey, number][]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const skillLine = skills.length ? `技能上最拿手的是「${SKILL_META[skills[0][0]].label}」（${skills[0][1]}）。` : '你还没有积累起明显的职业技能。';
  const careerLine = job
    ? `你在${TRACK_META[job.track].label}线上累计工作了 ${s.player.trackDays[job.track] ?? 0} 天，当前绩效 ${Math.round(s.player.performance)}。`
    : '';
  const lines = [
    `${s.player.name}，${getAge(s)} 岁，已经在第二人生里度过了 ${s.day} 天。`,
    `目前${job ? `担任「${job.name}」` : s.player.occupation === 'student' ? '是一名在读学生' : '暂时没有工作'}，累计工作 ${s.player.workDays} 天，学识 ${s.player.knowledge}。`,
    ...(careerLine ? [careerLine] : []),
    skillLine,
    `财富 ¥${Math.round(s.player.money).toLocaleString('zh-CN')}；累计收入 ¥${Math.round(s.stats.totalEarned).toLocaleString('zh-CN')}，累计支出 ¥${Math.round(s.stats.totalSpent).toLocaleString('zh-CN')}。`,
    `最突出的属性是「${ATTR_META[best[0]].label}」（${best[1]}）。`,
    closest ? `与你最亲近的人是${closest.name}（好感度 ${closest.affinity}）。` : '你还没有结识任何人。',
    `一路上你做出了 ${s.stats.eventsResolved} 次抉择，解锁了 ${Object.keys(s.achievements).length}/${ACHIEVEMENTS.length} 项成就。`,
  ];
  return { title, lines };
}
