import { describe, expect, it } from 'vitest';
import { LOAN_MAX, LOAN_MIN, LOAN_MIN_CREDIT } from '../content';
import { bankLoanRate, endDay, loanLimit, repayBankLoan, takeBankLoan } from '../engine';
import { CURRENT_VERSION, migrate } from '../migrate';
import type { GameState } from '../types';
import { dateParts } from '../util';
import { cleanState, seededRng, startedGame } from './helpers';

/** 推到「本月最后一天」，下一次 endDay 触发月初结算 */
function beforeMonthStart(s: GameState): GameState {
  const st = cleanState(s);
  while (dateParts(st.startISO, st.day + 1).d !== 1) st.day += 1;
  return st;
}

function withCredit(credit: number): GameState {
  const s = cleanState(startedGame());
  s.player.credit = credit;
  s.player.money = 10000;
  return s;
}

const loan = (remaining: number, monthly = 500): GameState['player']['bankLoan'] =>
  ({ amount: 5000, remaining, monthly, rate: 0.15, startedDay: 0 });

describe('可贷额度与利率由信用分决定', () => {
  it('信用分过低不放贷', () => {
    const s = withCredit(LOAN_MIN_CREDIT - 1);
    expect(loanLimit(s)).toBe(0);
    expect(takeBankLoan(s, LOAN_MIN).result.ok).toBe(false);
  });

  it('额度随信用分上升，且不超过上限', () => {
    expect(loanLimit(withCredit(600))).toBeGreaterThan(0);
    expect(loanLimit(withCredit(700))).toBeGreaterThan(loanLimit(withCredit(600)));
    expect(loanLimit(withCredit(850))).toBeLessThanOrEqual(LOAN_MAX);
  });

  it('利率在 6%~18% 之间且信用越高越低', () => {
    const low = bankLoanRate(withCredit(520));
    const high = bankLoanRate(withCredit(850));
    expect(low).toBeLessThanOrEqual(0.18);
    expect(high).toBeGreaterThanOrEqual(0.06);
    expect(high).toBeLessThan(low);
  });
});

describe('贷款：借款与还款', () => {
  it('借款到账、记录贷款并降低一点信用分', () => {
    const s = withCredit(650);
    const before = s.player.money;
    const r = takeBankLoan(s, 5000);
    expect(r.result.ok).toBe(true);
    expect(r.state.player.money).toBe(before + 5000);
    expect(r.state.player.bankLoan).toMatchObject({ amount: 5000 });
    expect(r.state.player.bankLoan!.remaining).toBeGreaterThan(5000); // 含利息
    expect(r.state.player.bankLoan!.monthly).toBeGreaterThan(0);
    expect(r.state.player.credit).toBe(642);
    expect(r.state.transactions.some((t) => t.note === '银行贷款' && t.amount === 5000)).toBe(true);
  });

  it('拒绝低于最低额、超过额度、已有贷款与信用分不足', () => {
    const s = withCredit(650);
    expect(takeBankLoan(s, LOAN_MIN - 1).result.ok).toBe(false);
    expect(takeBankLoan(s, loanLimit(s) + 1).result.ok).toBe(false);
    const taken = takeBankLoan(s, 3000).state;
    expect(takeBankLoan(taken, 3000).result.ok).toBe(false);
  });

  it('部分还款减少剩余并提升信用分', () => {
    const s = withCredit(650);
    s.player.bankLoan = loan(2000);
    const r = repayBankLoan(s, 800);
    expect(r.result.ok).toBe(true);
    expect(r.state.player.bankLoan!.remaining).toBe(1200);
    expect(r.state.player.credit).toBe(652);
    expect(r.state.player.money).toBe(9200);
  });

  it('还清后清除贷款并提升信用分', () => {
    const s = withCredit(650);
    s.player.bankLoan = loan(400);
    const r = repayBankLoan(s, 400);
    expect(r.state.player.bankLoan).toBeNull();
    expect(r.state.player.credit).toBe(675);
  });

  it('拒绝超出剩余、超过现金与非法金额', () => {
    const s = withCredit(650);
    s.player.bankLoan = loan(1000);
    expect(repayBankLoan(s, 1200).result.ok).toBe(false);
    expect(repayBankLoan(s, 20000).result.ok).toBe(false);
    expect(repayBankLoan(s, 0).result.ok).toBe(false);
  });
});

describe('每月自动还款', () => {
  it('月初自动扣款并获得信用分', () => {
    const s = beforeMonthStart(withCredit(650));
    s.player.money = 20000;
    s.player.bankLoan = loan(2000, 500);
    const r = endDay(s, seededRng(31));
    expect(r.state.player.bankLoan!.remaining).toBe(1500);
    expect(r.state.player.credit).toBe(651);
    expect(r.state.transactions.some((t) => t.note === '银行贷款还款' && t.amount === -500)).toBe(true);
    expect(r.state.morningReport.join(' ')).toContain('贷款还款');
  });

  it('现金不足时逾期，信用分下降', () => {
    const s = beforeMonthStart(withCredit(650));
    // 用「已工作」身份避免学生月初津贴把现金补回来，这样扣完月供才会真的变负
    s.player.occupation = 'employed';
    s.player.jobId = 'cashier';
    s.player.money = 0;
    s.player.bankLoan = loan(2000, 500);
    const r = endDay(s, seededRng(32));
    expect(r.state.player.money).toBeLessThan(0);
    expect(r.state.player.credit).toBe(635);
    expect(r.state.morningReport.join(' ')).toContain('逾期');
  });

  it('最后一期扣完自动结清并提升信用分', () => {
    const s = beforeMonthStart(withCredit(650));
    s.player.money = 20000;
    s.player.bankLoan = loan(300, 500);
    const r = endDay(s, seededRng(33));
    expect(r.state.player.bankLoan).toBeNull();
    expect(r.state.player.credit).toBe(675);
    expect(r.state.morningReport.join(' ')).toContain('结清');
  });

  it('没有贷款时不产生额外扣款', () => {
    const s = beforeMonthStart(withCredit(650));
    s.player.money = 20000;
    const r = endDay(s, seededRng(34));
    expect(r.state.transactions.some((t) => t.note.includes('银行贷款'))).toBe(false);
  });
});

describe('迁移：v5 → v6 贷款字段', () => {
  it('老存档补 null，损坏数据被清洗', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v5: Record<string, unknown> = { ...modern, version: 5 };
    const player = { ...(v5.player as Record<string, unknown>) };
    delete player.bankLoan;
    v5.player = player;
    expect(migrate(v5).player.bankLoan).toBeNull();

    const broken = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    broken.version = 6;
    broken.player = { ...(broken.player as Record<string, unknown>), bankLoan: { amount: 'x', remaining: -5 } };
    expect(migrate(broken).player.bankLoan).toBeNull();
  });

  it('合法贷款结构被保留并规范化为整数', () => {
    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 6;
    raw.player = { ...(raw.player as Record<string, unknown>), bankLoan: { amount: 5000.4, remaining: 4999.6, monthly: 450.2, rate: 0.12, startedDay: 3.8 } };
    const s = migrate(raw);
    expect(s.player.bankLoan).toEqual({ amount: 5000, remaining: 5000, monthly: 450, rate: 0.12, startedDay: 4 });
    expect(s.version).toBe(CURRENT_VERSION);
  });
});