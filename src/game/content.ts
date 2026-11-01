import type { ActivityCategory, AttrKey, Attrs, BackgroundKey, Effects, GameState, HousingId, InvestmentProduct, JobTrack, PersonalityKey, SkillKey } from './types';
import { dateParts, isWeekend } from './util';

// ===================== 规则常量 =====================
export const START_ISO = '2026-09-01';
export const MAX_AP = 10;
export const ATTR_MIN = 0;
export const ATTR_MAX = 100;
export const LIVING_COST = 45; // 每日基础开销
export const MAX_ATTR_DELTA = 15; // 单次效果的属性变化上限
export const MAX_MONEY_DELTA = 20000;
export const SOFTCAP_KEYS: AttrKey[] = ['intelligence', 'eq', 'fitness', 'charm'];
export const ATTR_KEYS: AttrKey[] = ['intelligence', 'eq', 'fitness', 'charm', 'happiness', 'health'];
export const BASE_ATTRS: Attrs = { intelligence: 40, eq: 40, fitness: 40, charm: 40, happiness: 60, health: 80 };
/** 技能类属性（智力/情商/体能/魅力）的全局成长系数：四年的人生弧线里，认真经营才能接近 85 */
export const SKILL_GROWTH = 0.45;
export const ALLOCATION_POOL = 12;
export const ALLOCATION_MAX_EACH = 8;

export const ATTR_META: Record<AttrKey, { label: string; color: string; desc: string }> = {
  intelligence: { label: '智力', color: '#7aa7ff', desc: '学习效率、求职与检定' },
  eq: { label: '情商', color: '#f58fb4', desc: '人际互动与冲突处理' },
  fitness: { label: '体能', color: '#ff9e5e', desc: '运动、精力与抗压' },
  charm: { label: '魅力', color: '#b7a0ff', desc: '社交、面试与机遇' },
  happiness: { label: '幸福感', color: '#f6c25b', desc: '长期低迷会拖垮一切' },
  health: { label: '健康', color: '#3dd6a3', desc: '过低会被迫住院' },
};

export const PERSONALITIES: Record<PersonalityKey, {
  label: string; emoji: string; desc: string; mods: Partial<Attrs>; likes: ActivityCategory[]; dislikes: ActivityCategory[];
}> = {
  extrovert: { label: '外向开朗', emoji: '☀️', desc: '在人群中充电，独处太久会闷。', mods: { charm: 4, eq: 2 }, likes: ['social', 'entertainment'], dislikes: ['rest'] },
  introvert: { label: '内向沉静', emoji: '🌙', desc: '安静时思路最清晰，社交很耗电。', mods: { intelligence: 4, eq: 1 }, likes: ['study', 'rest'], dislikes: ['social'] },
  rational: { label: '理性严谨', emoji: '🧭', desc: '凡事讲逻辑，偏爱效率和计划。', mods: { intelligence: 5 }, likes: ['study', 'work'], dislikes: ['entertainment'] },
  romantic: { label: '感性浪漫', emoji: '🌹', desc: '共情力强，对美好事物格外敏感。', mods: { eq: 5, happiness: 2 }, likes: ['entertainment', 'social'], dislikes: ['work'] },
  adventurous: { label: '冒险进取', emoji: '🔥', desc: '坐不住，总想试试没走过的路。', mods: { fitness: 4, charm: 2 }, likes: ['exercise', 'work'], dislikes: ['rest'] },
  steady: { label: '稳重踏实', emoji: '🪨', desc: '慢热但可靠，把日子过得扎实。', mods: { health: 5, eq: 2 }, likes: ['work', 'rest'], dislikes: ['entertainment'] },
};

export const BACKGROUNDS: Record<BackgroundKey, {
  label: string; emoji: string; desc: string; money: number; allowance: number; mods: Partial<Attrs>;
}> = {
  ordinary: { label: '普通工薪家庭', emoji: '🏠', desc: '不缺吃穿，但也没有余裕任性。', money: 6000, allowance: 1800, mods: {} },
  wealthy: { label: '富裕家庭', emoji: '💎', desc: '起点优渥，也背着不小的期待。', money: 30000, allowance: 4500, mods: { charm: 3, happiness: 4 } },
  scholarly: { label: '书香门第', emoji: '📚', desc: '家里书比家具多，从小耳濡目染。', money: 10000, allowance: 2200, mods: { intelligence: 5, eq: 1 } },
  rural: { label: '农村家庭', emoji: '🌾', desc: '手头紧，但身体结实、吃得了苦。', money: 2500, allowance: 1500, mods: { fitness: 4, health: 5, eq: 2 } },
  single: { label: '单亲家庭', emoji: '🕯️', desc: '早早学会体察人心，也更懂得独立。', money: 3500, allowance: 1600, mods: { eq: 5, happiness: -3 } },
  business: { label: '创业家庭', emoji: '🚀', desc: '饭桌上聊的都是生意，见过起落。', money: 15000, allowance: 3000, mods: { charm: 4, eq: 2 } },
};

export const HOBBIES = ['阅读', '游戏', '运动', '音乐', '绘画', '摄影', '烹饪', '编程', '旅行', '电影'];
export const FEMALE_NAMES = ['林晚晴', '苏念', '顾星河', '许安然', '沈知意', '江小鹿'];
export const MALE_NAMES = ['陆行舟', '江亦辰', '周屿', '程子墨', '宋怀安', '叶长风'];

// ===================== 行动 =====================
export interface Activity {
  id: string;
  category: ActivityCategory;
  name: string;
  desc: string;
  ap: number;
  money: number;
  effects: Effects;
  hobbies?: string[];
  narr: string[];
  special?: 'meet' | 'hobby';
  socialNpc?: number;
  when?: (s: GameState) => string | null;
  /** 这项行动锻炼哪项职业技能（第三阶段） */
  skill?: SkillKey;
  /** 技能经验（0~10，内部按概率取整） */
  skillGain?: number;
}
const weekday = (s: GameState) => dateParts(s.startISO, s.day);

export const ACTIVITIES: Activity[] = [
  // ---- 学习 ----
  { id: 's_self', category: 'study', name: '自习复习', desc: '泡在图书馆，把知识一点点啃下来。', ap: 2, money: 0,
    skill: 'writing', skillGain: 1.2,
    effects: { attrs: { intelligence: 1.5, happiness: -0.5 }, knowledge: 4 },
    narr: ['你在图书馆坐了一下午，笔记写满了三页。', '安静的自习室里，难题终于被你拆解开了。'] },
  { id: 's_class', category: 'study', name: '去上课', desc: '学生专属。认真听课，积累扎实的学识。', ap: 4, money: 0,
    skill: 'writing', skillGain: 1.5,
    effects: { attrs: { intelligence: 2.5, happiness: -1, health: -0.5 }, knowledge: 8 },
    when: (s) => (s.player.occupation !== 'student' ? '只有在读学生才需要上课。' : isWeekend(weekday(s)) ? '今天是周末，没有课。' : null),
    narr: ['整整一天的课程让你脑子发胀，但收获不小。', '教授的一个例子让你忽然理解了困扰已久的概念。'] },
  { id: 's_read', category: 'study', name: '读一本书', desc: '拓宽视野，也让心安静下来。', ap: 2, money: 0, hobbies: ['阅读'],
    skill: 'language', skillGain: 1,
    effects: { attrs: { intelligence: 1, eq: 1, happiness: 1 }, knowledge: 3 },
    narr: ['翻完了半本书，有几句话你想记很久。', '书页间的世界比窗外更辽阔。'] },
  { id: 's_skill', category: 'study', name: '在线课程', desc: '花点钱学一项可迁移的技能。', ap: 3, money: 80, hobbies: ['编程'],
    skill: 'coding', skillGain: 3,
    effects: { attrs: { intelligence: 2 }, knowledge: 7 },
    narr: ['你跟着网课敲完了一整套练习，成就感满满。', '新技能解锁，简历上又能多写一行了。'] },
  // ---- 运动 ----
  { id: 'e_run', category: 'exercise', name: '慢跑', desc: '零成本的体能训练。', ap: 2, money: 0,
    effects: { attrs: { fitness: 1.8, health: 1.2, happiness: 1 } },
    narr: ['晚风掠过耳畔，你一口气跑完了五公里。', '呼吸渐渐平稳，烦心事被甩在了身后。'] },
  { id: 'e_gym', category: 'exercise', name: '健身房训练', desc: '系统训练，见效更快。', ap: 3, money: 40, 
    effects: { attrs: { fitness: 3, health: 1.5, charm: 0.6, happiness: 0.5 } },
    narr: ['杠铃一次次升起，肌肉酸胀却很踏实。', '教练纠正了你的动作，今天的训练格外高效。'] },
  { id: 'e_ball', category: 'exercise', name: '球类运动', desc: '约上几个人打一场球。', ap: 2, money: 10, hobbies: ['运动'],
    effects: { attrs: { fitness: 1.8, happiness: 2, eq: 0.4 } },
    narr: ['一记漂亮的配合让全场都叫了好。', '汗水淋漓地打完一场，痛快。'] },
  // ---- 社交 ----
  { id: 'so_meet', category: 'social', name: '结识新朋友', desc: '走出舒适区，也许会遇到有趣的人。', ap: 2, money: 0, special: 'meet',
    effects: { attrs: { charm: 1, eq: 0.8 } },
    narr: ['你主动搭话，在人群里转了一圈。'] },
  { id: 'so_party', category: 'social', name: '参加聚会', desc: '热闹的场合，认识更多人。', ap: 3, money: 90, socialNpc: 3,
    skill: 'communication', skillGain: 1.5,
    effects: { attrs: { charm: 1.5, eq: 1, happiness: 2.5 } },
    narr: ['灯光、音乐和笑声，你成了今晚话题的一部分。', '聚会散场时已是深夜，手机里多了几个新联系人。'] },
  { id: 'so_club', category: 'social', name: '社团活动', desc: '和志同道合的人一起做点事。', ap: 3, money: 0, socialNpc: 2,
    skill: 'communication', skillGain: 1.5,
    effects: { attrs: { charm: 1, eq: 1.5, intelligence: 0.5, happiness: 1.5 } },
    narr: ['社团的策划会开得热火朝天，你领到了一项任务。', '一起搬器材、写海报，不知不觉熟络起来。'] },
  // ---- 娱乐 ----
  { id: 'en_game', category: 'entertainment', name: '打游戏', desc: '放空大脑，快乐加倍。', ap: 2, money: 0, hobbies: ['游戏'],
    effects: { attrs: { happiness: 3.5, health: -0.6 } },
    narr: ['连赢三把，你忍不住对着屏幕握拳。', '一不小心就打到了半夜。'] },
  { id: 'en_movie', category: 'entertainment', name: '看电影', desc: '一张票换两小时的另一种人生。', ap: 2, money: 50, hobbies: ['电影'],
    effects: { attrs: { happiness: 3, eq: 0.5 } },
    narr: ['片尾字幕升起时，你还沉浸在故事里。', '散场后你绕路走了很久，只想把这份感觉多留一会儿。'] },
  { id: 'en_shop', category: 'entertainment', name: '逛街购物', desc: '给自己添点新东西。', ap: 2, money: 150,
    effects: { attrs: { happiness: 3, charm: 1 } },
    narr: ['你买下了一件一直惦记的外套，镜子里的自己精神了不少。'] },
  { id: 'en_hobby', category: 'entertainment', name: '投入爱好', desc: '把时间交给真正喜欢的事。', ap: 2, money: 0, special: 'hobby',
    effects: { attrs: { happiness: 3.5, eq: 0.5, charm: 0.5 } },
    when: (s) => (s.player.hobbies.length ? null : '你还没有登记任何爱好。'),
    narr: ['你花了一整个下午投入在「{hobby}」里，时间仿佛静止了。', '「{hobby}」让你重新找回了专注的感觉。'] },
  { id: 'en_trip', category: 'entertainment', name: '周边短途游', desc: '花一整天，去一个没去过的地方。', ap: 6, money: 600, hobbies: ['旅行', '摄影'],
    effects: { attrs: { happiness: 9, health: 1, charm: 0.8, eq: 0.5 } },
    narr: ['陌生的街道、陌生的风，你拍下了很多照片。', '一天的旅途结束，你带着晒红的脸颊和满满的见闻回家。'] },
  // ---- 休息 ----
  { id: 'r_nap', category: 'rest', name: '小睡片刻', desc: '补个觉，恢复精力。', ap: 1, money: 0,
    effects: { attrs: { health: 1, happiness: 0.5 } },
    narr: ['一觉醒来，窗外的光线已经偏黄。'] },
  { id: 'r_walk', category: 'rest', name: '放松散步', desc: '什么也不想，走一走。', ap: 2, money: 0,
    effects: { attrs: { health: 1.5, happiness: 2, eq: 0.3 } },
    narr: ['你沿着河边慢慢走，心里的结松开了一些。'] },
];

// ===================== 经济系统（第三阶段） =====================
/** 储蓄年化利率（每月按 1/12 计息） */
export const SAVINGS_ANNUAL_RATE = 0.02;
/** 单次存入/取出/买入的最小金额 */
export const INVEST_MIN = 100;
/** 理财单笔上限，避免一次操作把存档数值推到离谱 */
export const INVEST_MAX = 500000;

// ===================== 资产（第三阶段 3.1.5） =====================
export interface AssetDef {
  id: string;
  name: string;
  emoji: string;
  price: number;
  desc: string;
  /** 加成作用范围（用于 UI 分类与引擎判定） */
  scope: 'study' | 'social' | 'exercise' | 'entertainment' | 'travel';
}
export const ASSETS: AssetDef[] = [
  { id: 'laptop', name: '笔记本电脑', emoji: '💻', price: 4500, scope: 'study', desc: '学习效率提升：学习类行动学识 +15%，编程技能成长 +25%。' },
  { id: 'phone', name: '新手机', emoji: '📱', price: 2200, scope: 'social', desc: '社交更顺畅：与 NPC 互动的好感收益 +10%。' },
  { id: 'bike', name: '自行车', emoji: '🚲', price: 900, scope: 'exercise', desc: '运动更方便：运动类行动的体能与健康收益 +20%。' },
  { id: 'guitar', name: '民谣吉他', emoji: '🎸', price: 1500, scope: 'entertainment', desc: '娱乐更尽兴：娱乐类行动的幸福感 +1。' },
  { id: 'camera', name: '二手相机', emoji: '📷', price: 3200, scope: 'travel', desc: '旅行与摄影加成：娱乐类行动学识 +2，幸福感 +0.5。' },
];
export const getAssetById = (id: string) => ASSETS.find((a) => a.id === id);

// ===================== 居住（第三阶段 3.1.6） =====================
/** 默认居住（与家人同住 / 学校宿舍）：无房租，舒适度一般 */
export const DEFAULT_HOUSING: { name: string; emoji: string; rent: number; comfort: number; desc: string } = {
  name: '家里 / 宿舍', emoji: '🏠', rent: 0, comfort: 50, desc: '不花钱，但空间与自由都有限。',
};
export interface HousingDef { id: HousingId; name: string; emoji: string; rent: number; comfort: number; desc: string }
export const HOUSINGS: HousingDef[] = [
  { id: 'shared', name: '合租单间', emoji: '🚪', rent: 900, comfort: 62, desc: '和陌生人共享客厅，通勤一般，胜在便宜。' },
  { id: 'studio', name: '整租一居', emoji: '🛋️', rent: 1600, comfort: 82, desc: '属于自己的空间，睡眠质量明显变好。' },
];
export const getHousingById = (id: string | null | undefined) => (id ? HOUSINGS.find((h) => h.id === id) ?? null : null);
/** 当前居住信息（含默认居住），供引擎与 UI 共用 */
export function housingOf(id: string | null | undefined): { name: string; emoji: string; rent: number; comfort: number; desc: string } {
  return getHousingById(id) ?? DEFAULT_HOUSING;
}
/** 搬家一次性费用 = 首月房租的一半（默认居住 → 租房；退租回家固定 ¥200） */
export const moveCostOf = (toId: HousingId | null) => (toId ? Math.round(housingOf(toId).rent / 2) : 200);

// ===================== 银行贷款（第三阶段 3.1.4） =====================
/** 最低贷款额 */
export const LOAN_MIN = 1000;
/** 最高贷款额（还要受信用分限制） */
export const LOAN_MAX = 30000;
/** 还款期数（月） */
export const LOAN_TERM = 12;
/** 信用分低于这个值不放贷 */
export const LOAN_MIN_CREDIT = 520;
/** 可贷额度 = (信用分 - 500) × 该系数，上限 LOAN_MAX（信用 650 → ¥9,000，850 → ¥21,000） */
export const LOAN_LIMIT_FACTOR = 60;

export interface InvestmentProductDef {
  id: InvestmentProduct;
  name: string;
  desc: string;
  /** 月均收益率 */
  meanRate: number;
  /** 月度波动幅度（±） */
  vol: number;
  risk: '低' | '中' | '高';
}

export const INVESTMENT_PRODUCTS: InvestmentProductDef[] = [
  { id: 'fund', name: '货币基金', desc: '几乎不会亏，收益略高于储蓄。', meanRate: 0.0016, vol: 0.0006, risk: '低' },
  { id: 'index', name: '指数基金', desc: '长期向上，短期随市场波动。', meanRate: 0.006, vol: 0.03, risk: '中' },
  { id: 'high', name: '进取组合', desc: '高风险高回报，可能大幅回撤。', meanRate: 0.012, vol: 0.08, risk: '高' },
];
export const getInvestmentProduct = (id: string) => INVESTMENT_PRODUCTS.find((p) => p.id === id);

// ===================== 技能与职业线（第三阶段） =====================
export const SKILL_META: Record<SkillKey, { label: string; desc: string; emoji: string }> = {
  coding: { label: '编程', desc: '技术岗的核心能力，也能让在线课程更有收获。', emoji: '💻' },
  communication: { label: '沟通', desc: '销售、服务业与团队协作的基础。', emoji: '🗣️' },
  writing: { label: '写作', desc: '文案、报告与行政工作的硬通货。', emoji: '✍️' },
  language: { label: '外语', desc: '教育行业与外企的加分项。', emoji: '🌐' },
};
export const SKILL_KEYS: SkillKey[] = ['coding', 'communication', 'writing', 'language'];
export const SKILL_MAX = 100;

export const TRACK_META: Record<JobTrack, { label: string; skill: SkillKey; emoji: string }> = {
  service: { label: '服务业', skill: 'communication', emoji: '🛎️' },
  tech: { label: '技术', skill: 'coding', emoji: '💻' },
  sales: { label: '销售', skill: 'communication', emoji: '📞' },
  admin: { label: '行政人事', skill: 'writing', emoji: '🗂️' },
  education: { label: '教育', skill: 'language', emoji: '📚' },
};

// ===================== 工作 =====================
export interface JobReq {
  knowledge?: number;
  intelligence?: number;
  eq?: number;
  charm?: number;
  /** 累计工作天数（老条件，保留兼容） */
  workDays?: number;
  /** 本职业线累计工作天数（转行后归零） */
  trackDays?: number;
  /** 对应技能等级要求 */
  skills?: Partial<Record<SkillKey, number>>;
}
export interface Job {
  id: string; name: string; track: JobTrack; level: number; wage: number; ap: number; partTime: boolean; weekdaysOnly: boolean;
  desc: string; req: JobReq;
  narr: string[];
}
export const JOBS: Job[] = [
  // ---- 服务业 ----
  { id: 'cashier', name: '便利店店员', track: 'service', level: 1, wage: 130, ap: 4, partTime: true, weekdaysOnly: false, req: {},
    desc: '兼职。门槛最低，随时可上岗。', narr: ['你站了一个班，扫码、补货、微笑，顾客说了好几声谢谢。', '夜班很安静，你顺手把货架整理得整整齐齐。'] },
  { id: 'shift_lead', name: '门店领班', track: 'service', level: 2, wage: 240, ap: 5, partTime: true, weekdaysOnly: false, req: { trackDays: 20, skills: { communication: 20 } },
    desc: '兼职。需要一点带班经验。', narr: ['你排好了今天的班表，还帮新来的同事顶了一个岗。', '顾客的投诉被你三言两语化解，店长对你点了点头。'] },
  { id: 'store_manager', name: '店长', track: 'service', level: 3, wage: 430, ap: 6, partTime: false, weekdaysOnly: true, req: { trackDays: 70, skills: { communication: 45 } },
    desc: '全职。一家门店的盈亏都由你负责。', narr: ['你盯着月末的盘点表，把损耗压到了历史最低。', '早会上你布置完任务，又在后仓搬了两箱货。'] },
  // ---- 技术 ----
  { id: 'intern_dev', name: '实习开发', track: 'tech', level: 2, wage: 320, ap: 6, partTime: false, weekdaysOnly: true, req: { skills: { coding: 15 }, knowledge: 40 },
    desc: '全职。技术线的起点，需要一点编程底子。', narr: ['你修好了第一个线上小 bug，手心全是汗。', '导师 review 了你的代码，指出三处可以改得更清楚。'] },
  { id: 'junior_dev', name: '初级开发工程师', track: 'tech', level: 3, wage: 540, ap: 6, partTime: false, weekdaysOnly: true, req: { skills: { coding: 35 }, trackDays: 25, knowledge: 70 },
    desc: '全职。能独立完成模块了。', narr: ['你独立交付了一个小模块，测试全部通过。', '需求又改了一版，你平静地打开编辑器。'] },
  { id: 'dev', name: '开发工程师', track: 'tech', level: 4, wage: 820, ap: 6, partTime: false, weekdaysOnly: true, req: { skills: { coding: 60 }, trackDays: 80, knowledge: 110 },
    desc: '全职。团队里的主力。', narr: ['你主导了一次架构重构，接口响应快了一倍。', '你花了一下午排查一个偶发的线上问题，最后发现是时区。'] },
  { id: 'tech_lead', name: '技术负责人', track: 'tech', level: 5, wage: 1300, ap: 6, partTime: false, weekdaysOnly: true, req: { skills: { coding: 80 }, trackDays: 160, eq: 55 },
    desc: '全职。带团队，也扛结果。', narr: ['你拍板了下个季度的技术路线，团队的争论终于有了结论。', '你替团队挡住了一次不合理的排期。'] },
  // ---- 销售 ----
  { id: 'sales_assistant', name: '销售助理', track: 'sales', level: 2, wage: 300, ap: 6, partTime: false, weekdaysOnly: true, req: { skills: { communication: 10 } },
    desc: '全职。销售线的起点。', narr: ['你整理完客户名单，又跟着前辈跑了两家。', '第一次独立打电话，对方没等你说完就挂了。'] },
  { id: 'specialist', name: '业务专员', track: 'sales', level: 3, wage: 480, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 70, trackDays: 20, eq: 48, skills: { communication: 25 } },
    desc: '全职。需要一定的资历与情商。', narr: ['你跟进的客户终于松口，签下了一份不大不小的单子。', '一天下来电话打了二十多通，嗓子有点哑。'] },
  { id: 'supervisor', name: '部门主管', track: 'sales', level: 4, wage: 760, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 110, trackDays: 80, eq: 55, charm: 50, skills: { communication: 50 } },
    desc: '全职。开始带团队。', narr: ['你主持了周会，把分歧压了下去，让方案落了地。', '团队的进度由你兜底，这份责任很沉。'] },
  { id: 'manager', name: '部门经理', track: 'sales', level: 5, wage: 1200, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 160, trackDays: 200, eq: 62, intelligence: 60, skills: { communication: 70 } },
    desc: '全职。掌舵一个部门。', narr: ['你在董事会汇报了季度计划，对方点了点头。', '一个重要决策由你拍板，结果将在下个季度揭晓。'] },
  // ---- 行政人事 ----
  { id: 'assistant', name: '行政助理', track: 'admin', level: 2, wage: 300, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 35, skills: { writing: 5 } },
    desc: '全职，周一至周五。职场起点。', narr: ['你整理文件、订会议室、回复邮件，把琐事处理得井井有条。', '同事们开始习惯把杂事交给你。'] },
  { id: 'hr_specialist', name: '人事专员', track: 'admin', level: 3, wage: 470, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 60, trackDays: 20, skills: { writing: 25 } },
    desc: '全职。招聘、培训与员工关系。', narr: ['你面了六个人，最后留下了一个眼里有光的。', '一份员工手册被你改到第五版，终于没人挑出毛病。'] },
  { id: 'hr_manager', name: '人事经理', track: 'admin', level: 4, wage: 800, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 100, trackDays: 80, skills: { writing: 50 }, eq: 55 },
    desc: '全职。管人和管制度。', narr: ['你顶住压力，把一次不合理的裁员名单压了下来。', '年度调薪方案由你主导，会议室里的空气终于松了下来。'] },
  // ---- 教育 ----
  { id: 'tutor', name: '家教老师', track: 'education', level: 1, wage: 220, ap: 3, partTime: true, weekdaysOnly: false, req: { knowledge: 20, intelligence: 45 },
    desc: '兼职。需要扎实的学识。', narr: ['你把一道难题讲了三种解法，学生终于露出了恍然大悟的表情。', '课后家长发来感谢的消息。'] },
  { id: 'teacher', name: '中学教师', track: 'education', level: 3, wage: 540, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 80, skills: { language: 20 }, trackDays: 20 },
    desc: '全职。讲台之上，责任之下。', narr: ['你讲完最后一节课，嗓子已经哑了，但学生们还在问问题。', '你改完两个班的作业，批注写得比原文还多。'] },
  { id: 'head_teacher', name: '教研组长', track: 'education', level: 4, wage: 830, ap: 6, partTime: false, weekdaysOnly: true, req: { knowledge: 130, trackDays: 80, skills: { language: 45 }, eq: 52 },
    desc: '全职。带教研组，也带年轻教师。', narr: ['你组织了一次公开课，年轻老师在台下记满了笔记。', '一份教研计划被你改到深夜，终于说服了所有人。'] },
];
export const getJobById = (id: string | null) => (id ? JOBS.find((j) => j.id === id) ?? null : null);

/** 同一职业线里，比当前高一级、且条件已满足的下一个职位（用于绩效晋升） */
export function nextJobInTrack(job: Job, s: GameState): Job | null {
  const cands = JOBS.filter((j) => j.track === job.track && j.level === job.level + 1 && j.id !== job.id);
  return cands.find((j) => unmetRequirements(s, j).length === 0) ?? null;
}

export const REQ_LABEL: Record<string, string> = {
  knowledge: '学识', intelligence: '智力', eq: '情商', charm: '魅力', workDays: '工作天数', trackDays: '本行业天数',
};
/** 返回未满足的条件描述，空数组表示满足（技能与行业天数是第三阶段新增条件） */
export function unmetRequirements(s: GameState, job: Job): string[] {
  const out: string[] = [];
  const p = s.player;
  const cur: Record<string, number> = {
    knowledge: p.knowledge, intelligence: p.attrs.intelligence, eq: p.attrs.eq, charm: p.attrs.charm,
    workDays: p.workDays, trackDays: p.trackDays[job.track] ?? 0,
  };
  for (const [k, v] of Object.entries(job.req)) {
    if (k === 'skills' || v === undefined) continue;
    if (v !== null && cur[k] < v) out.push(`${REQ_LABEL[k] ?? k} ${cur[k]}/${v}`);
  }
  for (const [k, v] of Object.entries(job.req.skills ?? {})) {
    const have = p.skills[k as SkillKey] ?? 0;
    if (v !== undefined && have < v) out.push(`${SKILL_META[k as SkillKey].label} ${have}/${v}`);
  }
  return out;
}

// ===================== 成就 =====================
export interface Achievement { id: string; name: string; desc: string; icon: string; check: (s: GameState) => boolean }
const metCount = (s: GameState, min: number) => s.npcs.filter((n) => n.met && n.affinity >= min).length;
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_week', name: '适应新生活', desc: '度过第一周。', icon: '🌱', check: (s) => s.day >= 7 },
  { id: 'first_month', name: '独当一面', desc: '度过一个月。', icon: '🗓️', check: (s) => s.day >= 30 },
  { id: 'one_year', name: '一年之约', desc: '在第二人生里生活满一年。', icon: '🎂', check: (s) => s.day >= 365 },
  { id: 'first_job', name: '第一份工作', desc: '成功获得一份工作。', icon: '💼', check: (s) => !!s.player.jobId || s.player.workDays > 0 },
  { id: 'salary_man', name: '职场老手', desc: '累计工作 50 天。', icon: '🧳', check: (s) => s.player.workDays >= 50 },
  { id: 'first_savings', name: '第一桶金', desc: '财富达到 ¥10,000。', icon: '💰', check: (s) => s.player.money >= 10000 },
  { id: 'rich', name: '小有积蓄', desc: '财富达到 ¥50,000。', icon: '🏦', check: (s) => s.player.money >= 50000 },
  { id: 'scholar', name: '学有所成', desc: '学识达到 100。', icon: '🎓', check: (s) => s.player.knowledge >= 100 },
  { id: 'iron_body', name: '钢铁之躯', desc: '体能达到 80。', icon: '🏋️', check: (s) => s.player.attrs.fitness >= 80 },
  { id: 'bright_mind', name: '大脑发光', desc: '智力达到 80。', icon: '🧠', check: (s) => s.player.attrs.intelligence >= 80 },
  { id: 'charmer', name: '万人迷', desc: '魅力达到 80。', icon: '✨', check: (s) => s.player.attrs.charm >= 80 },
  { id: 'joyful', name: '快乐星球', desc: '幸福感达到 90。', icon: '🌞', check: (s) => s.player.attrs.happiness >= 90 },
  { id: 'friends5', name: '朋友遍地', desc: '与 5 位以上的人好感度达到 30。', icon: '🤝', check: (s) => metCount(s, 30) >= 5 },
  { id: 'bestie', name: '挚友', desc: '与任一人物好感度达到 80。', icon: '💞', check: (s) => metCount(s, 80) >= 1 },
  { id: 'everyone', name: '认识所有人', desc: '结识全部人物。', icon: '🗺️', check: (s) => s.npcs.every((n) => n.met) },
  { id: 'in_debt', name: '负债累累', desc: '财富跌入负数。（黑历史）', icon: '📉', check: (s) => s.player.money < 0 },
  { id: 'savings_50k', name: '存钱这件事', desc: '储蓄达到 ¥50,000。', icon: '🏛️', check: (s) => s.player.savings >= 50000 },
  { id: 'first_invest', name: '第一笔投资', desc: '买入任意一项理财产品。', icon: '📈', check: (s) => s.player.investments.length > 0 },
  { id: 'invest_profit', name: '落袋为安', desc: '卖出理财累计盈利 ¥1,000。', icon: '💹', check: (s) => typeof s.flags.investProfit === 'number' && (s.flags.investProfit as number) >= 1000 },
  { id: 'first_promotion', name: '更进一步', desc: '第一次获得晋升。', icon: '🪜', check: (s) => typeof s.flags.promotions === 'number' && (s.flags.promotions as number) >= 1 },
  { id: 'promoted3', name: '职场三级跳', desc: '累计晋升 3 次。', icon: '🏢', check: (s) => typeof s.flags.promotions === 'number' && (s.flags.promotions as number) >= 3 },
  { id: 'skill_50', name: '一技之长', desc: '任意职业技能达到 50。', icon: '🛠️', check: (s) => SKILL_KEYS.some((k) => (s.player.skills[k] ?? 0) >= 50) },
  { id: 'perf_90', name: '年度最佳', desc: '绩效达到 90。', icon: '🏅', check: (s) => s.player.performance >= 90 },
  { id: 'survived_layoff', name: '劫后余生', desc: '被裁员后重新找到工作。', icon: '🧯', check: (s) => typeof s.flags.laidOffDay === 'number' && !!s.player.jobId },
  { id: 'first_asset', name: '第一件装备', desc: '购买任意一件资产。', icon: '🎁', check: (s) => s.player.assets.length >= 1 },
  { id: 'all_assets', name: '装备齐全', desc: '集齐全部资产。', icon: '🏠', check: (s) => s.player.assets.length >= ASSETS.length },
  // ---- 3.5 扩充：长期目标与人生节点 ----
  { id: 'day_100', name: '百日光阴', desc: '在第二人生里生活满 100 天。', icon: '📅', check: (s) => s.day >= 100 },
  { id: 'money_100k', name: '六位数', desc: '财富达到 ¥100,000。', icon: '🤑', check: (s) => s.player.money >= 100000 },
  { id: 'savings_10k', name: '会存钱的人', desc: '储蓄达到 ¥10,000。', icon: '🏦', check: (s) => s.player.savings >= 10000 },
  { id: 'skill_100', name: '炉火纯青', desc: '任意职业技能达到 100。', icon: '🏆', check: (s) => SKILL_KEYS.some((k) => (s.player.skills[k] ?? 0) >= 100) },
  { id: 'first_loan', name: '第一次借贷', desc: '向银行借过一笔贷款。', icon: '🧾', check: (s) => typeof s.flags.loansTaken === 'number' && (s.flags.loansTaken as number) >= 1 },
  { id: 'loan_free', name: '无债一身轻', desc: '还清一笔银行贷款。', icon: '🕊️', check: (s) => typeof s.flags.loansCleared === 'number' && (s.flags.loansCleared as number) >= 1 },
  { id: 'in_love', name: '心之所向', desc: '和某个人确定恋爱关系。', icon: '💗', check: (s) => Object.keys(s.flags).some((k) => k.startsWith('partner_')) || (typeof s.flags.breakups === 'number' && s.flags.breakups > 0) },
  { id: 'heartbreak', name: '体面的告别', desc: '经历过一次分手。', icon: '🥀', check: (s) => typeof s.flags.breakups === 'number' && (s.flags.breakups as number) >= 1 },
  { id: 'seasoned', name: '四季轮转', desc: '在同一份人生里跨过 4 次新年。', icon: '🎆', check: (s) => s.day >= 365 * 4 },
  { id: 'work_365', name: '一年工龄', desc: '累计工作 365 天。', icon: '📆', check: (s) => s.player.workDays >= 365 },
  { id: 'asset_3', name: '小有家当', desc: '拥有 3 件资产。', icon: '📦', check: (s) => s.player.assets.length >= 3 },
  { id: 'invest_3', name: '分散投资', desc: '同时持有 3 笔理财。', icon: '🧺', check: (s) => s.player.investments.length >= 3 },
  { id: 'loan_3', name: '信用良好', desc: '累计结清 3 笔银行贷款。', icon: '✅', check: (s) => typeof s.flags.loansCleared === 'number' && (s.flags.loansCleared as number) >= 3 },
  { id: 'knowledge_200', name: '博览群书', desc: '学识达到 200。', icon: '📚', check: (s) => s.player.knowledge >= 200 },
  { id: 'fitness_90', name: '身体力行', desc: '体能达到 90。', icon: '🦵', check: (s) => s.player.attrs.fitness >= 90 },
  { id: 'renter', name: '独立生活', desc: '第一次自己租房。', icon: '🔑', check: (s) => s.player.housing !== null },
  { id: 'studio_renter', name: '一间自己的房', desc: '住进整租一居。', icon: '🛋️', check: (s) => s.player.housing === 'studio' },
];
