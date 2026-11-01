import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_PROGRESS, achievementProgress, annualReviews } from '../review';
import { cleanState, startedGame } from './helpers';

describe('annualReviews：年度回顾', () => {
  it('按年份汇总收支与重要事件', () => {
    const s = cleanState(startedGame());
    s.log = [];
    s.transactions = [];
    s.achievements = {};
    s.transactions = [
      { id: 'a', day: 0, amount: 1800, category: '津贴', note: '津贴' },
      { id: 'b', day: 10, amount: -45, category: '生活', note: '日常' },
      { id: 'c', day: 400, amount: 3000, category: '工资', note: '工资' },
    ];
    s.log = [
      { id: 'l1', day: 5, kind: 'event', title: '开学', text: '', importance: 3 },
      { id: 'l2', day: 6, kind: 'event', title: '开学', text: '', importance: 3 },
      { id: 'l3', day: 420, kind: 'event', title: '入职', text: '', importance: 3 },
      { id: 'l4', day: 430, kind: 'action', title: '慢跑', text: '', importance: 1 },
    ];
    s.achievements = { one_year: 370 };
    const rows = annualReviews(s);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ year: 2026, income: 1800, expense: 45, net: 1755 });
    expect(rows[0].keyMoments).toEqual(['开学']);
    expect(rows[1].year).toBe(2027);
    expect(rows[1].income).toBe(3000);
    expect(rows[1].keyMoments).toContain('入职');
    expect(rows[1].achievements).toBeGreaterThanOrEqual(1);
    expect(rows[1].headline).toContain('入职');
  });

  it('空档返回空数组，负数净支出也能表示', () => {
    const empty = cleanState(startedGame());
    empty.log = [];
    empty.transactions = [];
    empty.achievements = {};
    expect(annualReviews(empty)).toEqual([]);
    const s = cleanState(startedGame());
    s.log = [];
    s.transactions = [{ id: 'x', day: 3, amount: -500, category: '医疗', note: '看病' }];
    const row = annualReviews(s)[0];
    expect(row.net).toBe(-500);
    expect(row.headline).toContain('艰难');
  });

  it('最多返回 limit 年', () => {
    const s = cleanState(startedGame());
    s.transactions = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, day: i * 400, amount: -10, category: '生活' as const, note: '' }));
    expect(annualReviews(s, 3).length).toBeLessThanOrEqual(3);
  });
});

describe('成就进度', () => {
  it('计数类成就给出当前/目标', () => {
    const s = cleanState(startedGame());
    s.player.workDays = 20;
    s.player.knowledge = 40;
    s.npcs = s.npcs.map((n) => (n.id === 'mom' ? { ...n, affinity: 50 } : n));
    expect(achievementProgress(s, 'salary_man')).toEqual([20, 50]);
    expect(achievementProgress(s, 'scholar')).toEqual([40, 100]);
    expect(achievementProgress(s, 'friends5')?.[0]).toBeGreaterThanOrEqual(1);
    expect(achievementProgress(s, 'one_year')).toEqual([0, 365]);
  });

  it('非计数类与未知成就不给进度', () => {
    const s = cleanState(startedGame());
    expect(achievementProgress(s, 'in_debt')).toBeNull();
    expect(achievementProgress(s, 'not_exists')).toBeNull();
    expect(Object.keys(ACHIEVEMENT_PROGRESS).length).toBeGreaterThan(10);
  });

  it('进度被限制在 [0, total] 且不会超过目标', () => {
    const s = cleanState(startedGame());
    s.player.knowledge = 999;
    expect(achievementProgress(s, 'scholar')).toEqual([100, 100]);
    s.player.workDays = 0;
    expect(achievementProgress(s, 'salary_man')).toEqual([0, 50]);
  });
});
