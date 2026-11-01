import { describe, expect, it } from 'vitest';
import { INVEST_MAX, INVEST_MIN, INVESTMENT_PRODUCTS } from '../content';
import { buyInvestment, deposit, endDay, sellInvestment, withdraw } from '../engine';
import { CURRENT_VERSION, migrate } from '../migrate';
import type { GameState } from '../types';
import { cleanState, seededRng, startedGame, TEST_INPUT } from './helpers';

import { dateParts } from '../util';

/** 把状态推进到「本月最后一天」，下一次 endDay 就会触发月初结算 */
function beforeMonthStart(s: GameState): GameState {
  const st = cleanState(s);
  while (dateParts(st.startISO, st.day + 1).d !== 1) st.day += 1;
  return st;
}

describe('储蓄：deposit / withdraw', () => {
  it('存入后现金减少、储蓄增加，并记账', () => {
    const s = cleanState(startedGame());
    s.player.money = 5000;
    const r = deposit(s, 2000);
    expect(r.result.ok).toBe(true);
    expect(r.state.player.money).toBe(3000);
    expect(r.state.player.savings).toBe(2000);
    expect(r.state.transactions.some((t) => t.note === '转入储蓄' && t.amount === -2000)).toBe(true);
  });

  it('拒绝低于最小额、超过现金与超过单笔上限', () => {
    const s = cleanState(startedGame());
    s.player.money = 5000;
    expect(deposit(s, INVEST_MIN - 1).result.ok).toBe(false);
    expect(deposit(s, 6000).result.ok).toBe(false);
    expect(deposit(s, INVEST_MAX + 1).result.ok).toBe(false);
  });

  it('取出不能超过储蓄余额', () => {
    const s = cleanState(startedGame());
    s.player.money = 0;
    s.player.savings = 1000;
    expect(withdraw(s, 1500).result.ok).toBe(false);
    const r = withdraw(s, 800);
    expect(r.result.ok).toBe(true);
    expect(r.state.player.savings).toBe(200);
    expect(r.state.player.money).toBe(800);
  });

  it('金额为小数时取整，负数/NaN 被拒绝', () => {
    const s = cleanState(startedGame());
    s.player.money = 1000;
    expect(deposit(s, 500.6).state.player.savings).toBe(501);
    expect(deposit(s, -100).result.ok).toBe(false);
    expect(deposit(s, Number.NaN).result.ok).toBe(false);
  });
});

describe('理财：买入 / 卖出 / 月结', () => {
  it('买入创建持仓，卖出回款并清理持仓', () => {
    const s = cleanState(startedGame());
    s.player.money = 10000;
    const buy = buyInvestment(s, 'index', 3000);
    expect(buy.result.ok).toBe(true);
    expect(buy.state.player.money).toBe(7000);
    expect(buy.state.player.investments.length).toBe(1);
    const inv = buy.state.player.investments[0];

    // 人为把市值调高，验证卖出盈利记录到 flags 并解锁成就检查
    const rich = { ...buy.state, player: { ...buy.state.player, investments: [{ ...inv, value: 3600 }] } };
    const sell = sellInvestment(rich, inv.id);
    expect(sell.result.ok).toBe(true);
    expect(sell.state.player.money).toBe(7000 + 3600);
    expect(sell.state.player.investments.length).toBe(0);
    expect(sell.state.flags.investProfit).toBe(600);
  });

  it('卖出亏损时 investProfit 为负', () => {
    const s = cleanState(startedGame());
    s.player.money = 10000;
    const buy = buyInvestment(s, 'high', 1000);
    const inv = buy.state.player.investments[0];
    const poor = { ...buy.state, player: { ...buy.state.player, investments: [{ ...inv, value: 400 }] } };
    const sell = sellInvestment(poor, inv.id);
    expect(sell.state.flags.investProfit).toBe(-600);
  });

  it('拒绝未知产品、过小金额与余额不足', () => {
    const s = cleanState(startedGame());
    s.player.money = 500;
    expect(buyInvestment(s, 'nope' as never, 200).result.ok).toBe(false);
    expect(buyInvestment(s, 'fund', 50).result.ok).toBe(false);
    expect(buyInvestment(s, 'fund', 600).result.ok).toBe(false);
  });

  it('每月初结算：储蓄计息 + 理财按产品参数波动', () => {
    const s = beforeMonthStart(startedGame());
    s.player.savings = 12000;
    s.player.money = 10000;
    const buy = buyInvestment(s, 'index', 5000);
    const before = buy.state.player.investments[0].value;
    const r = endDay(buy.state, seededRng(11));
    expect(r.result.ok).toBe(true);
    // 利息 = 12000 * 0.02 / 12 = 20
    expect(r.state.player.savings).toBe(12020);
    const after = r.state.player.investments[0].value;
    expect(after).toBeGreaterThan(0);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(Math.ceil(before * 0.031) + 1);
    expect(r.state.morningReport.join(' ')).toContain('储蓄利息');
    expect(r.state.morningReport.join(' ')).toContain('理财月结');
  });

  it('所有产品参数都在合理区间（防止平衡被改坏）', () => {
    for (const p of INVESTMENT_PRODUCTS) {
      expect(p.meanRate).toBeGreaterThan(0);
      expect(p.meanRate).toBeLessThan(0.05);
      expect(p.vol).toBeGreaterThanOrEqual(0);
      expect(p.vol).toBeLessThan(0.2);
    }
  });

  it('带理财持仓的存档可序列化并继续结算', () => {
    const s = cleanState(startedGame());
    s.player.money = 10000;
    const st = buyInvestment(s, 'fund', 500).state;
    const round = JSON.parse(JSON.stringify(st)) as GameState;
    expect(round.player.investments.length).toBe(1);
    expect(endDay(round, seededRng(12)).result.ok).toBe(true);
  });
});

describe('迁移：v2 → v3 经济字段', () => {
  it('老存档补齐 savings / investments / credit', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v2: Record<string, unknown> = { ...modern, version: 2 };
    const player = { ...(v2.player as Record<string, unknown>) };
    delete player.savings;
    delete player.investments;
    delete player.credit;
    v2.player = player;

    const s = migrate(v2);
    expect(s.version).toBe(CURRENT_VERSION);
    expect(s.player.savings).toBe(0);
    expect(s.player.investments).toEqual([]);
    expect(s.player.credit).toBe(640);
  });

  it('损坏的持仓被清洗，信用分被夹紧', () => {
    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 3;
    const player = { ...(raw.player as Record<string, unknown>) };
    player.savings = -50;
    player.credit = 9999;
    player.investments = [{ id: 'ok', product: 'index', principal: 1000, value: 1100, openedDay: 3 }, { nope: true }, { id: 'x', product: 'weird', principal: 'a', value: 10 }];
    raw.player = player;
    const s = migrate(raw);
    expect(s.player.savings).toBe(0);
    expect(s.player.credit).toBe(850);
    expect(s.player.investments.length).toBe(2);
    expect(s.player.investments[1].product).toBe('fund');
    expect(s.player.investments[1].principal).toBe(0);
  });

  it('新游戏自带经济字段默认值', () => {
    const s = cleanState(startedGame());
    expect(s.player.savings).toBe(0);
    expect(s.player.investments).toEqual([]);
    expect(s.player.credit).toBeGreaterThanOrEqual(300);
    expect(s.version).toBe(CURRENT_VERSION);
    expect(TEST_INPUT.name).toBeTruthy();
  });
});