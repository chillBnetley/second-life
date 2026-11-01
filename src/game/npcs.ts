import type { Effects, Mood, NPC, Relation, RelationStage } from './types';

// ===================== 关系阶段 =====================
export const STAGE_META: Record<RelationStage, { label: string; minAffinity: number; emoji: string }> = {
  stranger: { label: '陌生', minAffinity: -100, emoji: '·' },
  acquaintance: { label: '熟人', minAffinity: 20, emoji: '🙂' },
  friend: { label: '朋友', minAffinity: 40, emoji: '🤝' },
  close: { label: '好友', minAffinity: 60, emoji: '💛' },
  best: { label: '挚友', minAffinity: 80, emoji: '💞' },
};
/** 好感度 → 关系阶段（纯函数，读档与交互后都会重算） */
export function stageForAffinity(affinity: number): RelationStage {
  if (affinity >= STAGE_META.best.minAffinity) return 'best';
  if (affinity >= STAGE_META.close.minAffinity) return 'close';
  if (affinity >= STAGE_META.friend.minAffinity) return 'friend';
  if (affinity >= STAGE_META.acquaintance.minAffinity) return 'acquaintance';
  return 'stranger';
}
/** 可发展恋爱线的初始 NPC（存档迁移与 NPC 创建共用这一份清单） */
export const ROMANCEABLE_IDS = ['xiaoxia', 'yiming'];

// ===================== 初始 NPC =====================
type NpcSeed = Omit<NPC, 'memories' | 'lastContactDay' | 'status' | 'mood' | 'trust' | 'stage'> & Partial<NPC>;
const base = (n: NpcSeed): NPC => {
  const npc: NPC = {
    memories: [], lastContactDay: 0, status: '在忙自己的事', mood: 'neutral',
    trust: 0, stage: 'stranger', romanceable: ROMANCEABLE_IDS.includes(n.id), ...n,
  };
  // 阶段永远由好感度推导，避免种子里手写不一致
  npc.stage = stageForAffinity(npc.affinity);
  return npc;
};

export function createInitialNpcs(): NPC[] {
  return [
    base({ id: 'mom', name: '林雅芳', age: 47, gender: '女', avatar: '👩', traits: ['热心', '温和', '务实'], role: '母亲', relation: 'family',
      background: '小学教师，操心惯了。嘴上总说「不用管我」，每次视频都会问你吃了没有。', affinity: 62, met: true,
      links: [{ id: 'dad', label: '夫妻' }, { id: 'granny', label: '旧识' }],
      memories: [{ day: 0, text: '送你到车站时，偷偷抹了眼泪。', tone: 'good' }] }),
    base({ id: 'dad', name: '周建国', age: 49, gender: '男', avatar: '👨', traits: ['严肃', '务实', '内向'], role: '父亲', relation: 'family',
      background: '话不多，但每月的转账从不迟到。心里其实很为你骄傲。', affinity: 52, met: true,
      links: [{ id: 'mom', label: '夫妻' }],
      memories: [{ day: 0, text: '默默帮你把行李搬上了车。', tone: 'good' }] }),
    base({ id: 'yiming', name: '赵一鸣', age: 18, gender: '男', avatar: '🧑‍🎤', traits: ['外向', '幽默', '热心'], role: '高中最好的朋友', relation: 'friend',
      background: '同桌三年的损友，选择了另一座城市的学校，随时能在手机里「复活」。', affinity: 46, met: true,
      links: [{ id: 'chenhao', label: '网友' }],
      memories: [{ day: 0, text: '毕业那晚，你们在操场约定「不许失联」。', tone: 'good' }] }),
    base({ id: 'granny', name: '李奶奶', age: 71, gender: '女', avatar: '👵', traits: ['温和', '热心', '感性'], role: '楼下邻居', relation: 'neighbor',
      background: '独居的退休护士，爱养花，常给你塞自己包的饺子。', affinity: 18, met: true,
      links: [{ id: 'mom', label: '旧识' }] }),
    base({ id: 'chenhao', name: '陈浩', age: 19, gender: '男', avatar: '🧢', traits: ['外向', '幽默'], role: '同班同学 / 篮球搭子', relation: 'classmate',
      background: '总是第一个到球场、最后一个离开的人，话痨，朋友遍天下。', affinity: 0, met: false, requires: 'student',
      links: [{ id: 'xiaoxia', label: '社团搭档' }, { id: 'yiming', label: '网友' }] }),
    base({ id: 'xiaoxia', name: '林小夏', age: 20, gender: '女', avatar: '🧑‍🎨', traits: ['内向', '感性', '温和'], role: '社团学姐', relation: 'friend',
      background: '摄影社的骨干，镜头里的世界比现实更温柔。需要时间才会向你敞开心扉。', affinity: 0, met: false,
      links: [{ id: 'chenhao', label: '社团搭档' }] }),
    base({ id: 'prof_zhou', name: '周文远', age: 52, gender: '男', avatar: '🧑‍🏫', traits: ['严肃', '务实'], role: '专业课教授', relation: 'mentor',
      background: '治学严谨，批作业毫不留情，但只要你认真，他愿意倾囊相授。', affinity: 0, met: false, requires: 'student',
      links: [] }),
    base({ id: 'ajie', name: '阿杰', age: 28, gender: '男', avatar: '💪', traits: ['外向', '热心', '务实'], role: '健身教练', relation: 'coach',
      background: '前省队运动员，嗓门大，心特别细。相信「坚持」比「天赋」重要。', affinity: 0, met: false,
      links: [] }),
    base({ id: 'wang', name: '王姐', age: 38, gender: '女', avatar: '👩‍💼', traits: ['务实', '严肃', '热心'], role: '便利店店长', relation: 'colleague',
      background: '一个人撑起一家店，刀子嘴豆腐心，谁偷懒她都看得见。', affinity: 0, met: false, requires: 'cashier',
      links: [] }),
  ];
}

// ===================== 互动 =====================
export type InteractionKind = 'chat' | 'meal' | 'exercise' | 'gift' | 'confide' | 'help' | 'borrow';
export interface Interaction {
  id: InteractionKind; label: string; desc: string; ap: number; money: number; base: number; minAffinity: number;
  intro: string; self: Effects['attrs'];
}
export const INTERACTIONS: Interaction[] = [
  { id: 'chat', label: '聊天', desc: '随便聊聊近况', ap: 1, money: 0, base: 2, minAffinity: -100, intro: '你找{name}聊了一会儿。', self: { happiness: 0.8 } },
  { id: 'meal', label: '请吃饭', desc: '一起吃顿好的（¥80）', ap: 2, money: 80, base: 4, minAffinity: -100, intro: '你请{name}吃了顿饭。', self: { happiness: 1.5 } },
  { id: 'exercise', label: '一起运动', desc: '约着流身汗', ap: 2, money: 0, base: 3, minAffinity: -100, intro: '你约{name}一起运动。', self: { fitness: 1, health: 0.8 } },
  { id: 'gift', label: '送礼物', desc: '挑一份心意（¥150）', ap: 1, money: 150, base: 5, minAffinity: -100, intro: '你给{name}挑了份礼物。', self: {} },
  { id: 'confide', label: '倾诉心事', desc: '好感度 ≥ 20 才会敞开心扉', ap: 1, money: 0, base: 3, minAffinity: 20, intro: '你向{name}说起了最近的烦恼。', self: { happiness: 2, eq: 0.3 } },
  { id: 'help', label: '请教 / 求助', desc: '好感度 ≥ 10，对方能给你一些指点', ap: 1, money: 0, base: 1, minAffinity: 10, intro: '你向{name}请教了一些事。', self: {} },
  { id: 'borrow', label: '借钱', desc: '好感度 ≥ 45，借 ¥500，30 天后归还', ap: 1, money: 0, base: -4, minAffinity: 45, intro: '你硬着头皮向{name}开了口。', self: {} },
];

export const HELP_BY_RELATION: Record<Relation, { text: string; effects: Effects }> = {
  mentor: { text: '对方指出了你思路中的盲点，让你受益匪浅。', effects: { attrs: { intelligence: 1.2 }, knowledge: 8 } },
  classmate: { text: '对方分享了笔记和学习窍门。', effects: { knowledge: 4, attrs: { intelligence: 0.5 } } },
  colleague: { text: '对方传授了几个职场上的小门道。', effects: { knowledge: 4, attrs: { eq: 0.8 } } },
  coach: { text: '对方帮你调整了训练计划。', effects: { attrs: { fitness: 1.5, health: 1 } } },
  friend: { text: '对方耐心听你理清了思路。', effects: { attrs: { eq: 1, happiness: 1 } } },
  family: { text: '家人的叮嘱虽然絮叨，却让你心里踏实。', effects: { attrs: { happiness: 2 } } },
  neighbor: { text: '老人家分享了许多生活智慧。', effects: { attrs: { eq: 0.8, happiness: 1 } } },
};

// 性格对不同互动的加成
export const KIND_TRAIT_BONUS: Record<InteractionKind, Record<string, number>> = {
  chat: { 外向: 1, 幽默: 1, 内向: -1, 严肃: -1 },
  meal: { 外向: 1, 务实: 1, 内向: -1 },
  exercise: { 外向: 1, 热心: 1, 内向: -1 },
  gift: { 务实: 1, 感性: 2, 严肃: -1 },
  confide: { 感性: 2, 温和: 2, 热心: 1, 严肃: -1, 务实: -1 },
  help: { 热心: 2, 严肃: -1 },
  borrow: { 热心: 1, 务实: -1 },
};
export const MOOD_BONUS: Record<Mood, number> = { happy: 1, excited: 1, neutral: 0, sad: -1, angry: -3, busy: 0 };
export const MOOD_LABEL: Record<Mood, string> = { happy: '心情不错', excited: '兴致高昂', neutral: '平静', sad: '有些低落', angry: '正在气头上', busy: '忙得团团转' };
export const RELATION_LABEL: Record<Relation, string> = {
  family: '家人', friend: '朋友', classmate: '同学', colleague: '同事', mentor: '导师', neighbor: '邻居', coach: '教练',
};

export function affinityTier(a: number): { label: string; color: string } {
  if (a < -40) return { label: '敌对', color: '#e0446f' };
  if (a < -10) return { label: '冷淡', color: '#ff7a59' };
  if (a < 10) return { label: '点头之交', color: '#8b90b3' };
  if (a < 30) return { label: '熟悉', color: '#7aa7ff' };
  if (a < 55) return { label: '友好', color: '#3dd6a3' };
  if (a < 80) return { label: '亲密', color: '#f6c25b' };
  return { label: '挚友', color: '#f58fb4' };
}

// ===================== 对话（本地模板；第二阶段由 AI 接管，模板作兜底） =====================
const LINES: Record<string, { good: string[]; bad: string[] }> = {
  外向: { good: ['哈哈，跟你聊天太开心了，下次还找我！', '走走走，下次我来安排，保证好玩！'], bad: ['啊……今天我有点没状态，改天再聊吧。', '嗯，是吗……（看了眼手机）'] },
  内向: { good: ['……谢谢你，我很少跟人说这么多话。', '和你在一起，我不用刻意找话题，挺好的。'], bad: ['嗯。（沉默了好一会儿）', '我可能需要一个人待一会儿。'] },
  严肃: { good: ['不错，你比我想象的更认真。', '这样很好，继续保持。'], bad: ['我现在没时间说这些。', '你这样的态度，我很难评价。'] },
  幽默: { good: ['你这人真有意思，笑得我肚子疼！', '再来一个段子，我请你喝奶茶！'], bad: ['呃……这个梗……好像没接上？', '我笑点比较高，抱歉哈。'] },
  务实: { good: ['这样实在，我喜欢。', '有来有往才长久，你办事让我放心。'], bad: ['说这些有什么用呢？', '我还有正事要办。'] },
  感性: { good: ['你有这份心，我真的很感动……', '被你这样记着，心里暖暖的。'], bad: ['我今天心情不太好，抱歉……', '也许是我想多了吧。'] },
  热心: { good: ['有事尽管找我，别客气！', '看你过得好，我也高兴。'], bad: ['别太勉强自己，也别勉强别人哦。', '这次我可能帮不上忙了。'] },
  温和: { good: ['慢慢来，我听着呢。', '你今天看起来比上次精神多了。'], bad: ['也许我们都需要冷静一下。', '我没有生气，只是有点累。'] },
};
const NEUTRAL = ['嗯，我知道了。', '最近就是老样子吧。', '哦，这样啊。', '挺好的。'];

export function dialogueLine(traits: string[], tone: 'good' | 'ok' | 'bad', rng: () => number): string {
  const t = traits[Math.floor(rng() * traits.length)];
  const pool = LINES[t];
  if (tone === 'ok' || !pool) return NEUTRAL[Math.floor(rng() * NEUTRAL.length)];
  const arr = tone === 'good' ? pool.good : pool.bad;
  return arr[Math.floor(rng() * arr.length)];
}

export const STATUS_POOL: Record<Relation, string[]> = {
  family: ['在家做饭', '刚看完新闻', '惦记着你', '在阳台浇花'],
  friend: ['在刷手机', '正准备出门', '在赶作业', '刚睡醒'],
  classmate: ['在球场', '在赶 ddl', '在食堂', '在宿舍打游戏'],
  colleague: ['在盘点货物', '在对账', '在值班'],
  mentor: ['在备课', '在开会', '在批改论文', '在办公室喝茶'],
  neighbor: ['在遛弯', '在晒太阳', '在择菜'],
  coach: ['在带学员', '在备课', '在练卧推'],
};
export const REACH_LINES = [
  '好久没联系了，最近怎么样？', '周末有空吗？想约你出来坐坐。', '看到一个东西，一下就想到你了。', '你最近还好吗？别一个人扛着。', '改天一起吃饭吧！',
];
