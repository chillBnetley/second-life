import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../content';
import { buyAsset, dismissYearReview, endDay, repayBankLoan, takeBankLoan } from '../engine';
import { achievementProgress } from '../review';
import { CURRENT_VERSION, migrate } from '../migrate';
import type { GameState } from '../types';
import { dateParts } from '../util';
import { cleanState, seededRng, startedGame } from './helpers';

/** 推进到指定日期前一天，让下一次 endDay 落在该日期 */
function dayBefore(s: GameState, m: number, d: number): GameState {
  const st = cleanState(s);
  while (!(dateParts(st.startISO, st.day + 1).m === m && dateParts(st.startISO, st.day + 1).d === d)) st.day += 1;
  return st;
}

const has = (s: GameState, id: string) => id in s.achievements;

describe('属性周快照（attrHistory）', () => {
  it('每 7 天记录一次六维快照', () => {
    let s = cleanState(startedGame());
    const before = s.attrHistory.length;
    for (let i = 0; i < 7; i++) s = cleanState(endDay(s, seededRng(40 + i)).state);
    expect(s.attrHistory.length).toBeGreaterThanOrEqual(before + 1);
    const last = s.attrHistory[s.attrHistory.length - 1];
    expect([0, 1, 2, 3, 4, 5]).toContain(last.day % 7);
    for (const k of ['intelligence', 'eq', 'fitness', 'charm', 'happiness', 'health']) {
      expect(Number.isInteger(last.attrs[k as keyof typeof last.attrs])).toBe(true);
    }
  });

  it('快照不会无限增长（上限 220）', () => {
    const s = cleanState(startedGame());
    s.attrHistory = Array.from({ length: 300 }, (_, i) => ({ day: i * 7, attrs: { ...s.player.attrs } }));
    const cleaned = migrate(JSON.parse(JSON.stringify({ ...s, version: CURRENT_VERSION })));
    expect(cleaned.attrHistory.length).toBeLessThanOrEqual(220);
    expect(cleaned.attrHistory[cleaned.attrHistory.length - 1].day).toBeGreaterThan(cleaned.attrHistory[0].day);
  });

  it('迁移：v7 老存档补空快照，坏数据被清洗', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v7: Record<string, unknown> = { ...modern, version: 7 };
    delete v7.attrHistory;
    expect(migrate(v7).attrHistory).toEqual([]);

    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 8;
    raw.attrHistory = [
      { day: 7, attrs: { intelligence: 999, eq: -5, happiness: 'x' } },
      { day: -3, attrs: {} },
      'junk',
      { day: 14, attrs: { charmer: 1 } },
    ];
    const s2 = migrate(raw);
    expect(s2.attrHistory.length).toBe(2);
    expect(s2.attrHistory[0]).toMatchObject({ day: 7 });
    expect(s2.attrHistory[0].attrs.intelligence).toBe(100);
    expect(s2.attrHistory[0].attrs.eq).toBe(0);
    expect(s2.attrHistory[1].day).toBe(14);
  });
});

describe('年度回顾提示', () => {
  it('跨年时标记待查看的年度，并可关闭', () => {
    const s = dayBefore(cleanState(startedGame()), 1, 1);
    const r = endDay(s, seededRng(50));
    expect(typeof r.state.flags.pendingReviewYear).toBe('number');
    const year = r.state.flags.pendingReviewYear as number;
    expect(year).toBe(2026);
    const dismissed = dismissYearReview(r.state);
    expect(dismissed.result.ok).toBe(true);
    expect(dismissed.state.flags.pendingReviewYear).toBeUndefined();
    expect(dismissYearReview(dismissed.state).result.ok).toBe(false);
  });

  it('非跨年日不标记年度回顾', () => {
    const s = cleanState(startedGame());
    for (let i = 0; i < 7; i++) {
      const r = endDay(s, seededRng(60 + i));
      if (!r.result.ok) break;
      expect(r.state.flags.pendingReviewYear).toBeUndefined();
    }
  });
});

describe('新成就与进度', () => {
  it('百日光阴、第一次借贷、无债一身轻、装备成就可以解锁', () => {
    let s = cleanState(startedGame());
    s.day = 100;
    s.player.money = 20000;
    s = { ...s, achievements: { ...s.achievements } };
    expect(ACHIEVEMENTS.find((a) => a.id === 'day_100')!.check(s)).toBe(true);

    const loan = takeBankLoan(s, 3000).state;
    expect(ACHIEVEMENTS.find((a) => a.id === 'first_loan')!.check(loan)).toBe(true);
    const cleared = repayBankLoan({ ...loan, player: { ...loan.player, money: 50000 } }, loan.player.bankLoan!.remaining).state;
    expect(ACHIEVEMENTS.find((a) => a.id === 'loan_free')!.check(cleared)).toBe(true);

    const asset = buyAsset(s, 'bike').state;
    expect(ACHIEVEMENTS.find((a) => a.id === 'first_asset')!.check(asset)).toBe(true);
  });

  it('成就数量达到 40+，且新增成就都有进度', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(40);
    const s = cleanState(startedGame());
    s.day = 50;
    for (const id of ['day_100', 'money_100k', 'savings_10k', 'skill_100', 'first_loan', 'loan_free', 'in_love', 'heartbreak', 'seasoned']) {
      const prog = achievementProgress(s, id);
      expect(prog, `${id} 应有进度`).not.toBeNull();
      expect(prog![0]).toBeLessThanOrEqual(prog![1]);
    }
    expect(achievementProgress(s, 'day_100')).toEqual([50, 100]);
  });

  it('成就 id 唯一，check 都是纯函数', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const s = cleanState(startedGame());
    const snapshot = JSON.stringify(s);
    for (const a of ACHIEVEMENTS) a.check(s);
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(has(s, 'one_year')).toBe(false);
  });
});