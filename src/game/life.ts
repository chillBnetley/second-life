/** 人生阶段与终局评分（第三阶段 3.6）：纯函数，便于单测与 UI 展示。 */
import { getJobById } from './content';
import { netWorth } from './finance';
import type { GameState } from './types';

export type LifeStageKey = 'study' | 'career' | 'family' | 'harvest' | 'retire';
export interface LifeStageDef { key: LifeStageKey; label: string; emoji: string; from: number; to: number; desc: string }

export const LIFE_STAGES: LifeStageDef[] = [
  { key: 'study', label: '求学阶段', emoji: '🎓', from: 18, to: 22, desc: '读书、试错、认识世界，也认识自己。' },
  { key: 'career', label: '立业阶段', emoji: '💼', from: 23, to: 29, desc: '把本事换成饭碗，把选择变成轨迹。' },
  { key: 'family', label: '成家阶段', emoji: '🏡', from: 30, to: 44, desc: '事业与家庭开始互相拉扯，也互相支撑。' },
  { key: 'harvest', label: '收获阶段', emoji: '🌾', from: 45, to: 59, desc: '前半生的选择开始显出结果。' },
  { key: 'retire', label: '退休之后', emoji: '🌇', from: 60, to: 200, desc: '故事走到了需要回望的时候。' },
];

/** 退休/终局年龄 */
export const RETIRE_AGE = 60;

export function lifeStageFor(age: number): LifeStageDef {
  return LIFE_STAGES.find((s) => age >= s.from && age <= s.to) ?? LIFE_STAGES[LIFE_STAGES.length - 1];
}

export interface ScorePart { label: string; score: number; max: number; detail: string }
export interface LifeScore { total: number; parts: ScorePart[]; title: string }

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * 人生评分（0~100）：健康与状态 20 + 能力 20 + 学识技能 15 + 事业 15 + 财富 15 + 关系 15。
 * 只读取状态，不做任何修改；终局页与档案页共用同一套口径。
 */
export function lifeScore(s: GameState): LifeScore {
  const p = s.player;
  const a = p.attrs;

  const wellbeing = clamp01((a.happiness + a.health) / 200) * 20;
  const ability = clamp01(avg([a.intelligence, a.eq, a.fitness, a.charm]) / 100) * 20;
  const knowledge = clamp01(p.knowledge / 200) * 8 + clamp01(avg(Object.values(p.skills)) / 100) * 7;
  const jobLevel = p.jobId ? (getJobById(p.jobId)?.level ?? 0) : 0;
  const career = clamp01(jobLevel / 5) * 8 + clamp01(p.performance / 100) * 7;
  const wealth = clamp01(Math.max(0, netWorth(s).total) / 200000) * 15;
  const met = s.npcs.filter((n) => n.met);
  const relationBase = met.length ? clamp01(avg(met.map((n) => (n.affinity + 100) / 200))) * 10 : 0;
  const partner = Object.keys(s.flags).some((k) => k.startsWith('partner_')) ? 5 : 0;
  const relation = relationBase + partner;

  const parts: ScorePart[] = [
    { label: '健康与状态', score: round1(wellbeing), max: 20, detail: `幸福感 ${a.happiness} · 健康 ${a.health}` },
    { label: '能力', score: round1(ability), max: 20, detail: `智 ${a.intelligence} / 情 ${a.eq} / 体 ${a.fitness} / 魅 ${a.charm}` },
    { label: '学识与技能', score: round1(knowledge), max: 15, detail: `学识 ${p.knowledge} · 技能均值 ${Math.round(avg(Object.values(p.skills)))}` },
    { label: '事业', score: round1(career), max: 15, detail: p.jobId ? `职级 ${jobLevel}/5 · 绩效 ${Math.round(p.performance)}` : '目前没有工作' },
    { label: '财富', score: round1(wealth), max: 15, detail: `净资产 ¥${Math.round(netWorth(s).total).toLocaleString('zh-CN')}` },
    { label: '关系', score: round1(relation), max: 15, detail: met.length ? `已结识 ${met.length} 人${partner ? ' · 有伴侣' : ''}` : '还没有结识任何人' },
  ];
  const total = Math.round(parts.reduce((sum, x) => sum + x.score, 0));
  return { total, parts, title: scoreTitle(total) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function scoreTitle(total: number): string {
  if (total >= 85) return '传奇人生';
  if (total >= 70) return '波澜壮阔';
  if (total >= 55) return '安稳充实';
  if (total >= 40) return '平平淡淡';
  return '跌宕起伏';
}
