/** 人生档案的统计（纯函数）：年度回顾、成就进度。不修改状态。 */
import type { GameState, LogEntry, Transaction } from './types';
import { dateParts } from './util';

export interface AnnualReview {
  year: number;
  /** 这一年经历的天数 */
  days: number;
  income: number;
  expense: number;
  net: number;
  /** 这一年最重要的几件事（importance=3 的日志标题） */
  keyMoments: string[];
  /** 这一年解锁的成就数 */
  achievements: number;
  /** 这一年最长的一段标题（用于标题行） */
  headline: string;
}

/** 按年份汇总人生档案（升序），最多返回最近 limit 年 */
export function annualReviews(s: GameState, limit = 20): AnnualReview[] {
  const yearOf = (day: number) => dateParts(s.startISO, day).y;
  const map = new Map<number, { min: number; max: number; income: number; expense: number; moments: LogEntry[]; achievements: number }>();

  const ensure = (year: number) => {
    let rec = map.get(year);
    if (!rec) {
      rec = { min: Infinity, max: -Infinity, income: 0, expense: 0, moments: [], achievements: 0 };
      map.set(year, rec);
    }
    return rec;
  };

  for (const t of s.transactions as Transaction[]) {
    const rec = ensure(yearOf(t.day));
    rec.min = Math.min(rec.min, t.day);
    rec.max = Math.max(rec.max, t.day);
    if (t.amount >= 0) rec.income += t.amount;
    else rec.expense += -t.amount;
  }
  for (const l of s.log as LogEntry[]) {
    const rec = ensure(yearOf(l.day));
    rec.min = Math.min(rec.min, l.day);
    rec.max = Math.max(rec.max, l.day);
    if (l.importance === 3) rec.moments.push(l);
  }
  // 成就解锁日来自 achievements 表（日志里的成就条目也算在表内，避免重复计数）
  for (const day of Object.values(s.achievements)) {
    const rec = ensure(yearOf(day));
    rec.min = Math.min(rec.min, day);
    rec.max = Math.max(rec.max, day);
    rec.achievements += 1;
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-limit)
    .map(([year, r]) => {
      const net = r.income - r.expense;
      const keyMoments = [...r.moments]
        .sort((a, b) => a.day - b.day)
        .map((l) => l.title)
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 5);
      const headline = keyMoments[0]
        ? `${keyMoments[0]}${net >= 0 ? '，这一年攒下了钱' : '，这一年过得有点紧'}`
        : net >= 0 ? '平稳的一年' : '有点艰难的一年';
      return {
        year,
        days: Number.isFinite(r.min) ? r.max - r.min + 1 : 0,
        income: r.income,
        expense: r.expense,
        net,
        keyMoments,
        achievements: Math.max(r.achievements, 0),
        headline,
      };
    });
}

/** 成就进度：返回 [当前, 目标]，目标为 0 表示没有可量化的进度 */
export type ProgressFn = (s: GameState) => [number, number];

/** 常见计数类成就的进度计算（键是成就 id，未列出的显示为「已达成/未达成」） */
export const ACHIEVEMENT_PROGRESS: Record<string, ProgressFn> = {
  one_year: (s) => [Math.min(s.day, 365), 365],
  first_job: (s) => [s.player.jobId ? 1 : 0, 1],
  salary_man: (s) => [Math.min(s.player.workDays, 50), 50],
  first_savings: (s) => [Math.min(Math.max(0, Math.round(s.player.money)), 10000), 10000],
  rich: (s) => [Math.min(Math.max(0, Math.round(s.player.money)), 50000), 50000],
  scholar: (s) => [Math.min(s.player.knowledge, 100), 100],
  iron_body: (s) => [Math.min(s.player.attrs.fitness, 80), 80],
  bright_mind: (s) => [Math.min(s.player.attrs.intelligence, 80), 80],
  charmer: (s) => [Math.min(s.player.attrs.charm, 80), 80],
  joyful: (s) => [Math.min(s.player.attrs.happiness, 90), 90],
  friends5: (s) => [Math.min(s.npcs.filter((n) => n.met && n.affinity >= 30).length, 5), 5],
  everyone: (s) => [s.npcs.filter((n) => n.met).length, s.npcs.length],
  savings_50k: (s) => [Math.min(Math.round(s.player.savings), 50000), 50000],
  skill_50: (s) => [Math.min(Math.max(...Object.values(s.player.skills), 0), 50), 50],
  all_assets: (s) => [s.player.assets.length, 5],
  first_promotion: (s) => [Math.min(typeof s.flags.promotions === 'number' ? s.flags.promotions : 0, 1), 1],
  promoted3: (s) => [Math.min(typeof s.flags.promotions === 'number' ? s.flags.promotions : 0, 3), 3],
  perf_90: (s) => [Math.min(Math.round(s.player.performance), 90), 90],
  day_100: (s) => [Math.min(s.day, 100), 100],
  money_100k: (s) => [Math.min(Math.max(0, Math.round(s.player.money)), 100000), 100000],
  savings_10k: (s) => [Math.min(Math.round(s.player.savings), 10000), 10000],
  skill_100: (s) => [Math.min(Math.max(...Object.values(s.player.skills), 0), 100), 100],
  first_loan: (s) => [Math.min(typeof s.flags.loansTaken === 'number' ? s.flags.loansTaken : 0, 1), 1],
  loan_free: (s) => [Math.min(typeof s.flags.loansCleared === 'number' ? s.flags.loansCleared : 0, 1), 1],
  in_love: (s) => [Object.keys(s.flags).some((k) => k.startsWith('partner_')) || typeof s.flags.breakups === 'number' ? 1 : 0, 1],
  heartbreak: (s) => [Math.min(typeof s.flags.breakups === 'number' ? s.flags.breakups : 0, 1), 1],
  seasoned: (s) => [Math.min(s.day, 365 * 4), 365 * 4],
  work_365: (s) => [Math.min(s.player.workDays, 365), 365],
  asset_3: (s) => [Math.min(s.player.assets.length, 3), 3],
  invest_3: (s) => [Math.min(s.player.investments.length, 3), 3],
  loan_3: (s) => [Math.min(typeof s.flags.loansCleared === 'number' ? s.flags.loansCleared : 0, 3), 3],
  knowledge_200: (s) => [Math.min(s.player.knowledge, 200), 200],
  fitness_90: (s) => [Math.min(Math.round(s.player.attrs.fitness), 90), 90],
};

export function achievementProgress(s: GameState, id: string): [number, number] | null {
  const fn = ACHIEVEMENT_PROGRESS[id];
  if (!fn) return null;
  const [cur, total] = fn(s);
  return [Math.max(0, Math.min(cur, total)), total];
}
