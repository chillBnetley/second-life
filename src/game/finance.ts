/** 财务统计（纯函数）：月度收支表、净资产构成。不修改任何状态。 */
import type { GameState, Transaction } from './types';
import { dateParts } from './util';

export interface MonthStat {
  key: string;
  year: number;
  month: number;
  label: string;
  income: number;
  expense: number;
  net: number;
}

/** 按月汇总收入/支出/结余（按时间升序，默认只保留最近 limit 个月） */
export function monthlyStatement(txs: Transaction[], startISO: string, limit = 12): MonthStat[] {
  const map = new Map<string, MonthStat>();
  for (const t of txs) {
    const p = dateParts(startISO, t.day);
    const key = `${p.y}-${String(p.m).padStart(2, '0')}`;
    let m = map.get(key);
    if (!m) {
      m = { key, year: p.y, month: p.m, label: `${p.y}年${p.m}月`, income: 0, expense: 0, net: 0 };
      map.set(key, m);
    }
    if (t.amount >= 0) m.income += t.amount;
    else m.expense += -t.amount;
  }
  return [...map.values()]
    .map((m) => ({ ...m, net: m.income - m.expense }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-limit);
}

export interface NetWorth {
  cash: number;
  savings: number;
  investments: number;
  /** 未归还的借款（每笔 ¥500） */
  debt: number;
  total: number;
}

export function netWorth(s: GameState): NetWorth {
  const cash = Math.round(s.player.money);
  const savings = Math.round(s.player.savings);
  const investments = s.player.investments.reduce((a, i) => a + Math.round(i.value), 0);
  const debt = Object.keys(s.flags).filter((k) => k.startsWith('loan_')).length * 500;
  return { cash, savings, investments, debt, total: cash + savings + investments - debt };
}

/** 支出构成（按类别汇总，降序） */
export function expenseBreakdown(txs: Transaction[]): { category: string; amount: number }[] {
  const by: Record<string, number> = {};
  for (const t of txs) if (t.amount < 0) by[t.category] = (by[t.category] ?? 0) - t.amount;
  return Object.entries(by).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}
