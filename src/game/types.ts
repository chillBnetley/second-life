// ===================== 基础类型 =====================
export type AttrKey = 'intelligence' | 'eq' | 'fitness' | 'charm' | 'happiness' | 'health';
export type Attrs = Record<AttrKey, number>;
export type ActivityCategory = 'study' | 'work' | 'exercise' | 'social' | 'entertainment' | 'rest';
export type EventCategory = 'daily' | 'social' | 'study' | 'work' | 'random' | 'major';
export type Occupation = 'student' | 'unemployed' | 'employed';
export type Relation = 'family' | 'friend' | 'classmate' | 'colleague' | 'mentor' | 'neighbor' | 'coach';
export type Mood = 'happy' | 'neutral' | 'sad' | 'angry' | 'busy' | 'excited';
export type TxCategory = '工资' | '津贴' | '生活' | '房租' | '娱乐' | '学习' | '社交' | '运动' | '医疗' | '事件' | '礼物' | '借还' | '其他';
export type FlagValue = boolean | number | string;
export type PersonalityKey = 'extrovert' | 'introvert' | 'rational' | 'romantic' | 'adventurous' | 'steady';
export type BackgroundKey = 'ordinary' | 'wealthy' | 'scholarly' | 'rural' | 'single' | 'business';

// ===================== 效果（规则引擎唯一的数值入口） =====================
export interface NpcEffect {
  id: string; // 可为 '$npc'（事件模板里的占位符）
  affinity?: number;
  memory?: string;
  mood?: Mood;
}
export interface Effects {
  attrs?: Partial<Attrs>;
  money?: number;
  knowledge?: number;
  ap?: number;
  npc?: NpcEffect[];
  flags?: Record<string, FlagValue>; // 仅本地可信来源可用
  occupation?: Occupation; // 仅本地可信来源可用
}

// ===================== 事件 =====================
export interface EventOutcome { weight: number; text: string; effects: Effects }
export interface EventChoice {
  id: string;
  label: string;
  hint?: string;
  cost?: number; // 选择时需要并扣除的金钱
  require?: { attr: AttrKey; min: number };
  check?: { attr: AttrKey; target: number }; // 属性检定：outcomes[0] 成功，outcomes[1] 失败
  outcomes: EventOutcome[];
}
export interface GameEvent {
  id: string;
  defId: string;
  category: EventCategory;
  title: string;
  description: string;
  npcId?: string;
  choices: EventChoice[];
  source: 'local' | 'ai';
  day: number;
}

// ===================== NPC =====================
export interface Memory { day: number; text: string; tone: 'good' | 'bad' | 'neutral' }
/** 关系阶段：由好感度阈值推导（第三阶段），恋爱线用 flags.partner_<id> 叠加 */
export type RelationStage = 'stranger' | 'acquaintance' | 'friend' | 'close' | 'best';
export interface NPC {
  id: string;
  name: string;
  age: number;
  gender: '男' | '女';
  avatar: string;
  traits: string[];
  role: string;
  relation: Relation;
  background: string;
  affinity: number; // -100 ~ 100
  /** 信任 -100~100：来自守约、倾诉、按时还钱等（与「好感」分离） */
  trust: number;
  /** 关系阶段（好感阈值推导，读档时自动重算） */
  stage: RelationStage;
  mood: Mood;
  status: string;
  memories: Memory[];
  met: boolean;
  lastContactDay: number;
  todayTalks?: number;
  links: { id: string; label: string }[];
  requires?: 'student' | 'cashier';
  /** 长期记忆摘要（≤200 字），记忆过多时由 AI 压缩写入；老存档为空串 */
  summary?: string;
  /** 是否可以发展恋爱线（第三阶段） */
  romanceable?: boolean;
}

// ===================== 玩家 / 存档 =====================
export type InvestmentProduct = 'fund' | 'index' | 'high';
/** 职业技能：影响应聘条件、工资与晋升（第三阶段） */
export type SkillKey = 'coding' | 'communication' | 'writing' | 'language';
/** 职业线：跨线跳槽会损失行业资历（trackDays 从 0 开始） */
export type JobTrack = 'service' | 'tech' | 'sales' | 'admin' | 'education';
export interface Investment {
  id: string;
  product: InvestmentProduct;
  /** 投入本金 */
  principal: number;
  /** 当前市值（每月结算波动） */
  value: number;
  openedDay: number;
  /** 最近一次月结收益率（百分比，展示用） */
  lastRate?: number;
}

/** 银行小额贷款（第三阶段 3.1.4）：按月等额还款，逾期扣信用分 */
export interface BankLoan {
  /** 到手本金 */
  amount: number;
  /** 剩余应还总额（含利息） */
  remaining: number;
  /** 每月应还 */
  monthly: number;
  /** 年化利率（小数） */
  rate: number;
  startedDay: number;
}

/** 居住方式（第三阶段 3.1.6）：null = 与家人同住 / 学校宿舍（无房租） */
export type HousingId = 'shared' | 'studio';

export interface Player {
  name: string;
  gender: '男' | '女';
  personality: PersonalityKey;
  background: BackgroundKey;
  hobbies: string[];
  attrs: Attrs;
  money: number;
  knowledge: number;
  occupation: Occupation;
  jobId: string | null;
  workDays: number;
  birthISO: string;
  /** 储蓄（与现金分离，每月计息，见 invest.ts） */
  savings: number;
  /** 理财持仓 */
  investments: Investment[];
  /** 信用分 300~850：影响可贷额度与贷款利息（第四阶段深化） */
  credit: number;
  /** 当前银行小额贷款（同时只能有一笔） */
  bankLoan: BankLoan | null;
  /** 已购买的资产 id（见 content.ts 的 ASSETS，提供长期小加成） */
  assets: string[];
  /** 当前居住方式；null 表示住家里/宿舍（无房租） */
  housing: HousingId | null;
  /** 本月累计税前工资 / 五险一金 / 个税（每月初清零，用于累计计税与工资明细） */
  monthGross: number;
  monthInsurance: number;
  monthTax: number;
  /** 职业技能 0~100 */
  skills: Record<SkillKey, number>;
  /** 各职业线累计工作天数（转行后从 0 开始，这就是「转行惩罚」） */
  trackDays: Partial<Record<JobTrack, number>>;
  /** 绩效 0~100，每月初评估：影响奖金、晋升与裁员 */
  performance: number;
  /** 上次绩效评估时的累计工作天数（用于算本月出勤） */
  lastReviewWorkDays: number;
}
export type LogKind = 'action' | 'event' | 'social' | 'work' | 'finance' | 'system' | 'achievement';
export interface LogEntry { id: string; day: number; kind: LogKind; title: string; text: string; importance: 1 | 2 | 3 }
export interface Transaction { id: string; day: number; amount: number; category: TxCategory; note: string }

export interface GameState {
  /** 存档结构版本，升级时通过 migrate.ts 的迁移链补齐字段（当前 2） */
  version: number;
  id: string;
  createdAt: number;
  updatedAt: number;
  startISO: string;
  day: number;
  ap: number;
  maxAp: number;
  player: Player;
  npcs: NPC[];
  pendingEvent: GameEvent | null;
  log: LogEntry[];
  transactions: Transaction[];
  wealthHistory: { day: number; money: number }[];
  /** 每周属性快照（用于档案里的六维变化曲线，最多保留 220 条 ≈ 4 年） */
  attrHistory: { day: number; attrs: Attrs }[];
  achievements: Record<string, number>;
  flags: Record<string, FlagValue>;
  todayCounts: Partial<Record<ActivityCategory, number>>;
  morningReport: string[];
  seenEvents: Record<string, number>;
  stats: { totalEarned: number; totalSpent: number; daysWorked: number; eventsResolved: number; actionsDone: number };
  /** 动态剧情线：让「选择有后果」，由本地代码或校验后的 AI 指令维护，最多 6 条 */
  storyThreads: StoryThread[];
  /** AI 调用预算与熔断（按游戏日计数，随存档持久化，防止刷新绕过限制） */
  ai: AIState;
}

// ===================== 剧情线 / AI 状态（version 2 新增） =====================
export interface StoryThread {
  id: string;
  title: string;
  /** 事实摘要，由本地代码拼接，长度有上限 */
  summary: string;
  openedDay: number;
  lastDay: number;
  status: 'open' | 'closed';
  npcIds: string[];
}

export interface AIState {
  /** 预算所属的游戏日；跨天自动重置 calls */
  day: number;
  calls: number;
  /** 连续失败次数（熔断依据） */
  failures: number;
  /** 熔断截止时间戳（毫秒）；0 表示未熔断 */
  cooldownUntil: number;
}

// ===================== 引擎结果 =====================
export interface Deltas {
  attrs: Partial<Attrs>;
  money: number;
  knowledge: number;
  ap: number;
  npc: { name: string; affinity: number }[];
}
export interface ActionResult {
  ok: boolean;
  title: string;
  text: string;
  deltas: Deltas;
  unlocked?: string[];
  eventTriggered?: boolean;
}
export interface EngineResult { state: GameState; result: ActionResult }

// ===================== AI 提案（必须经过 validate.ts 才能进入引擎） =====================
export interface AIActionProposal {
  category: ActivityCategory | 'other';
  title: string;
  narrative: string;
  apCost: number;
  moneyCost: number;
  effects: Effects;
}
export interface CreateInput {
  name: string;
  gender: '男' | '女';
  personality: PersonalityKey;
  background: BackgroundKey;
  hobbies: string[];
  allocation: Record<'intelligence' | 'eq' | 'fitness' | 'charm', number>;
}
