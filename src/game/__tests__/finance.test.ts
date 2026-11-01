import { describe, expect, it } from 'vitest';
import { expenseBreakdown, monthlyStatement, netWorth } from '../finance';
import type { Transaction } from '../types';
import { cleanState, startedGame } from './helpers';

const tx = (day: number, amount: number, category: Transaction['category'] = '其他', note = ''): Transaction =>
  ({ id: `t${day}_${amount}_${note}`, day, amount, category, note });

describe('monthlyStatement：月度收支表', () => {
  it('按年月汇总收入、支出与结余', () => {
    const txs = [
      tx(0, -45, '生活'), tx(0, 1800, '津贴'), tx(1, -100, '娱乐'),
      tx(40, -1500, '房租'), tx(40, 3000, '工资'),
    ];
    const rows = monthlyStatement(txs, '2026-09-01');
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ key: '2026-09', income: 1800, expense: 145, net: 1655 });
    expect(rows[1]).toMatchObject({ key: '2026-10', income: 3000, expense: 1500, net: 1500 });
  });

  it('只保留最近 limit 个月且升序排列', () => {
    const txs = Array.from({ length: 20 }, (_, i) => tx(i * 31, -100));
    const rows = monthlyStatement(txs, '2026-09-01', 3);
    expect(rows.length).toBe(3);
    expect(rows[0].key < rows[2].key).toBe(true);
  });

  it('空账本返回空数组', () => {
    expect(monthlyStatement([], '2026-09-01')).toEqual([]);
  });
});

describe('netWorth：净资产', () => {
  it('现金 + 储蓄 + 理财 - 借款', () => {
    const s = cleanState(startedGame());
    s.player.money = 1000;
    s.player.savings = 5000;
    s.player.investments = [{ id: 'i1', product: 'fund', principal: 2000, value: 2100, openedDay: 0 }];
    s.flags.loan_mom = s.day + 10;
    const w = netWorth(s);
    expect(w).toMatchObject({ cash: 1000, savings: 5000, investments: 2100, debt: 500, total: 7600 });
  });

  it('没有负债时 debt 为 0', () => {
    const s = cleanState(startedGame());
    expect(netWorth(s).debt).toBe(0);
  });
});

describe('expenseBreakdown：支出构成', () => {
  it('按类别汇总并降序', () => {
    const rows = expenseBreakdown([tx(0, -45, '生活'), tx(1, -45, '生活'), tx(2, -300, '娱乐')]);
    expect(rows[0]).toEqual({ category: '娱乐', amount: 300 });
    expect(rows[1]).toEqual({ category: '生活', amount: 90 });
  });
});