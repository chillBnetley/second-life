/**
 * 规则校验层：所有「不可信来源」（玩家自由输入、AI 返回的 JSON）都必须经过这里，
 * 才能变成引擎可执行的结构。AI 只能「提议」，数值上限、合法性由程序裁决。
 */
import { ATTR_KEYS } from './content';
import type {
  AIActionProposal, ActivityCategory, Attrs, EventCategory, EventChoice, EventOutcome, Effects, GameEvent, GameState, Mood, NpcEffect,
} from './types';
import { clamp, uid } from './util';

export interface Limits { attr: number; knowledge: number; affinity: number; moneyGainMax: number; moneyLossMax: number }
export const ACTION_LIMITS: Limits = { attr: 4, knowledge: 24, affinity: 5, moneyGainMax: 0, moneyLossMax: 0 };
export const EVENT_LIMITS: Limits = { attr: 6, knowledge: 10, affinity: 10, moneyGainMax: 1500, moneyLossMax: 2000 };
const MOODS: Mood[] = ['happy', 'neutral', 'sad', 'angry', 'busy', 'excited'];

/** 属性检定成功率：属性 = 目标时 50%，每差 8 点增减 10% */
export const checkChance = (value: number, target: number) => clamp(0.5 + (value - target) / 80, 0.1, 0.95);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, min: number, max: number): string | null => {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t.length >= min && t.length <= max ? t : null;
};

/** 只保留已知字段，并把所有数值夹到上限内。flags / occupation / ap 一律丢弃。 */
export function sanitizeEffects(fx: unknown, lim: Limits, s: GameState): Effects {
  const out: Effects = {};
  if (!isObj(fx)) return out;
  if (isObj(fx.attrs)) {
    const a: Partial<Attrs> = {};
    for (const k of ATTR_KEYS) {
      const v = Number((fx.attrs as Record<string, unknown>)[k]);
      if (Number.isFinite(v) && v !== 0) a[k] = clamp(v, -lim.attr, lim.attr);
    }
    if (Object.keys(a).length) out.attrs = a;
  }
  const money = Number(fx.money);
  if (Number.isFinite(money) && Math.round(money) !== 0) out.money = clamp(Math.round(money), -lim.moneyLossMax, lim.moneyGainMax);
  if (out.money === 0) delete out.money;
  const kn = Number(fx.knowledge);
  if (Number.isFinite(kn) && kn > 0) out.knowledge = clamp(kn, 0, lim.knowledge);
  if (Array.isArray(fx.npc)) {
    const list: NpcEffect[] = [];
    for (const raw of fx.npc.slice(0, 3)) {
      if (!isObj(raw) || typeof raw.id !== 'string') continue;
      const npc = s.npcs.find((n) => n.id === raw.id && n.met);
      if (!npc) continue;
      const e: NpcEffect = { id: npc.id };
      const aff = Number(raw.affinity);
      if (Number.isFinite(aff) && aff !== 0) e.affinity = clamp(aff, -lim.affinity, lim.affinity);
      const mem = str(raw.memory, 1, 80);
      if (mem) e.memory = mem;
      if (typeof raw.mood === 'string' && MOODS.includes(raw.mood as Mood)) e.mood = raw.mood as Mood;
      list.push(e);
    }
    if (list.length) out.npc = list;
  }
  return out;
}

// ===================== 行动提案校验 =====================
export type Validation<T> = { ok: true; value: T } | { ok: false; reason: string };
const ACTION_CATS: (ActivityCategory | 'other')[] = ['study', 'exercise', 'social', 'entertainment', 'rest', 'other'];

export function validateProposal(s: GameState, p: AIActionProposal): Validation<AIActionProposal> {
  if (!isObj(p)) return { ok: false, reason: '无法理解这个行动。' };
  if (!ACTION_CATS.includes(p.category)) return { ok: false, reason: '这类行动暂时不被支持。' };
  const ap = Math.round(Number(p.apCost));
  if (!(ap >= 1 && ap <= 8)) return { ok: false, reason: '这个行动耗时不合理（单次最多 8 点行动点）。' };
  if (ap > s.ap) return { ok: false, reason: `行动点不足：需要 ${ap}，今天只剩 ${s.ap}。` };
  const money = Math.round(Number(p.moneyCost) || 0);
  if (money < 0) return { ok: false, reason: '自由行动不能直接获得金钱，请通过工作或事件赚钱。' };
  if (money > s.player.money) return { ok: false, reason: `余额不足：需要 ${money}，你只有 ${Math.max(0, Math.round(s.player.money))}。` };
  const title = str(p.title, 1, 30) ?? '自由行动';
  const narrative = str(p.narrative, 1, 240) ?? '你按自己的想法度过了这段时间。';
  const fx = sanitizeEffects(p.effects, ACTION_LIMITS, s);
  delete fx.money;
  // 总收益与耗时挂钩：防止「一小时变成超人」
  if (fx.attrs) {
    const pos = Object.values(fx.attrs).reduce<number>((a, v) => a + (v && v > 0 ? v : 0), 0);
    const cap = 2.5 * ap + 2;
    if (pos > cap) {
      const k = cap / pos;
      for (const key of ATTR_KEYS) { const v = fx.attrs[key]; if (v && v > 0) fx.attrs[key] = v * k; }
    }
  }
  if (fx.knowledge) fx.knowledge = Math.min(fx.knowledge, 3 * ap);
  return { ok: true, value: { category: p.category, title, narrative, apCost: ap, moneyCost: money, effects: fx } };
}

// ===================== 自由输入：本地关键词解析（AI 不可用时的兜底，输出与 AI 同构的提案） =====================
export type Interpretation =
  | { kind: 'proposal'; proposal: AIActionProposal }
  | { kind: 'work' }
  | { kind: 'reject'; reason: string };

const FORBIDDEN = /(作弊|外挂|开挂|修改.*(属性|数值|金钱)|无限|亿万|抢劫|偷|杀人|毒品|黑客|秒变|一夜暴富|变成.*富|瞬间)/;
const EARN = /(赚钱|赚了|卖掉|中奖|捡钱|收入|发财)/;
interface Rule { re: RegExp; category: ActivityCategory; label: string; ap: number; money: number; fx: Effects; narr: string }
const RULES: Rule[] = [
  { re: /(学|复习|读书|看书|作业|考试|论文|编程|代码|背单词|刷题|研究)/, category: 'study', label: '自主学习', ap: 3, money: 0,
    fx: { attrs: { intelligence: 2, happiness: -0.5 }, knowledge: 5 }, narr: '你按自己的节奏投入了学习，思路越来越清晰。' },
  { re: /(跑|健身|运动|游泳|篮球|足球|羽毛球|瑜伽|锻炼|骑车|爬山)/, category: 'exercise', label: '自由锻炼', ap: 2, money: 0,
    fx: { attrs: { fitness: 2, health: 1, happiness: 1 } }, narr: '汗水浸透了衣服，身体感到轻盈而有力。' },
  { re: /(朋友|聊天|聚会|聚餐|约会|认识|表白|社交|吃饭|喝酒|唱K|KTV|拜访|家人)/, category: 'social', label: '自由社交', ap: 3, money: 60,
    fx: { attrs: { charm: 1.2, eq: 1, happiness: 2 } }, narr: '一番交谈下来，你对身边的人又多了一些了解。' },
  { re: /(游戏|电影|电视剧|追剧|逛|旅游|旅行|唱歌|音乐|购物|看展|露营|画画|摄影|做饭|烹饪)/, category: 'entertainment', label: '自由娱乐', ap: 2, money: 40,
    fx: { attrs: { happiness: 3.5, eq: 0.3 } }, narr: '你放下了所有烦恼，让自己好好享受了一段时间。' },
  { re: /(睡|休息|躺|放松|冥想|发呆|散步)/, category: 'rest', label: '放松休息', ap: 2, money: 0,
    fx: { attrs: { health: 1.5, happiness: 1.5 } }, narr: '什么都不做，也是一种很好的充电方式。' },
];

export function interpretFreeAction(s: GameState, text: string): Interpretation {
  const t = text.trim();
  if (!t) return { kind: 'reject', reason: '请先写下你想做的事。' };
  if (FORBIDDEN.test(t)) return { kind: 'reject', reason: '这超出了现实人生的规则：这里没有外挂，也不能做违法或不可能的事。' };
  if (EARN.test(t)) return { kind: 'reject', reason: '自由行动不能直接变出收入。去「工作」页面找份工作，或者留意日常中的机遇吧。' };
  if (/(上班|工作|加班|打工|兼职)/.test(t)) {
    return s.player.jobId ? { kind: 'work' } : { kind: 'reject', reason: '你还没有工作。去「工作」标签页应聘一份吧。' };
  }
  const rule = RULES.find((r) => r.re.test(t));
  const hoursM = t.match(/(\d+(?:\.\d+)?)\s*(?:个)?(?:小时|h|H)/);
  const moneyM = t.match(/(\d+(?:\.\d+)?)\s*(?:元|块|rmb|RMB|¥)/);
  let ap = rule?.ap ?? 1;
  if (hoursM) ap = clamp(Math.ceil(Number(hoursM[1]) / 1.5), 1, 8);
  let money = rule?.money ?? 0;
  if (moneyM) money = Math.round(Number(moneyM[1]));
  if (!rule) {
    return { kind: 'proposal', proposal: {
      category: 'other', title: '随心而为', apCost: ap, moneyCost: money,
      narrative: `你决定：${t.slice(0, 40)}。这段时间过得平静而随意。`,
      effects: { attrs: { happiness: 1 } },
    } };
  }
  // 金钱越多不等于收益越高：消费只在合理范围内放大幸福感
  const fx: Effects = { ...rule.fx, attrs: { ...rule.fx.attrs } };
  if (rule.category === 'entertainment' || rule.category === 'social') {
    fx.attrs!.happiness = (fx.attrs!.happiness ?? 0) + Math.min(2, money / 200);
  }
  return { kind: 'proposal', proposal: {
    category: rule.category, title: `${rule.label}：${t.slice(0, 18)}`, apCost: ap, moneyCost: money,
    narrative: rule.narr, effects: fx,
  } };
}

// ===================== AI 事件提案校验（第二阶段使用） =====================
const EVENT_CATS: EventCategory[] = ['daily', 'social', 'study', 'work', 'random'];
const ATTR_SET = new Set<string>(ATTR_KEYS);

export function validateEventProposal(s: GameState, raw: unknown): GameEvent | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title, 2, 24);
  const description = str(raw.description, 10, 320);
  if (!title || !description || !Array.isArray(raw.choices)) return null;
  const choices: EventChoice[] = [];
  for (const [i, rc] of raw.choices.slice(0, 4).entries()) {
    if (!isObj(rc)) continue;
    const label = str(rc.label, 1, 30);
    if (!label || !Array.isArray(rc.outcomes)) continue;
    const outcomes: EventOutcome[] = [];
    for (const ro of rc.outcomes.slice(0, 3)) {
      if (!isObj(ro)) continue;
      const text = str(ro.text, 1, 240);
      if (!text) continue;
      outcomes.push({ weight: clamp(Number(ro.weight) || 1, 1, 100), text, effects: sanitizeEffects(ro.effects, EVENT_LIMITS, s) });
    }
    if (!outcomes.length) continue;
    const ch: EventChoice = { id: `c${i}`, label, outcomes };
    const hint = str(rc.hint, 1, 40);
    if (hint) ch.hint = hint;
    const cost = Math.round(Number(rc.cost) || 0);
    if (cost > 0) ch.cost = Math.min(cost, 3000);
    if (isObj(rc.check) && ATTR_SET.has(String(rc.check.attr)) && outcomes.length >= 2) {
      ch.check = { attr: rc.check.attr as keyof Attrs, target: clamp(Math.round(Number(rc.check.target) || 50), 20, 90) };
    }
    choices.push(ch);
  }
  if (choices.length < 2) return null;
  const cat = EVENT_CATS.includes(raw.category as EventCategory) ? (raw.category as EventCategory) : 'random';
  const npcId = typeof raw.npcId === 'string' && s.npcs.some((n) => n.id === raw.npcId && n.met) ? (raw.npcId as string) : undefined;
  return { id: uid('ev'), defId: `ai_${uid('d')}`, category: cat, title, description, npcId, choices, source: 'ai', day: s.day };
}
