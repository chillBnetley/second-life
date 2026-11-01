import { describe, expect, it } from 'vitest';
import { INSURANCE_RATE, TAX_THRESHOLD, monthlyTax, monthNet, salaryBreakdown } from '../tax';
import { endDay, performWork } from '../engine';
import { CURRENT_VERSION, migrate } from '../migrate';
import type { GameState } from '../types';
import { dateParts } from '../util';
import { cleanState, seededRng, startedGame } from './helpers';

/** 推到本月最后一天，下一次 endDay 触发月初结算 */
function beforeMonthStart(s: GameState): GameState {
  const st = cleanState(s);
  while (dateParts(st.startISO, st.day + 1).d !== 1) st.day += 1;
  return st;
}

function employed(jobId: string): GameState {
  const s = cleanState(startedGame());
  s.player.jobId = jobId;
  s.player.occupation = 'employed';
  return s;
}

describe('个税与五险一金（纯函数）', () => {
  it('起征点以下不缴税，税率表分段正确', () => {
    expect(TAX_THRESHOLD).toBe(5000);
    expect(monthlyTax(0)).toBe(0);
    expect(monthlyTax(-100)).toBe(0);
    expect(monthlyTax(3000)).toBe(90);          // 3000 × 3%
    expect(monthlyTax(5000)).toBe(290);         // 90 + 2000 × 10%
    expect(monthlyTax(12000)).toBe(990);        // 12000 × 10% - 210
    expect(monthlyTax(20000)).toBe(2590);       // 20000 × 20% - 1410
  });

  it('全职按比例缴五险一金，兼职不缴', () => {
    expect(INSURANCE_RATE).toBe(0.175);
    const full = salaryBreakdown({ gross: 6000, partTime: false, monthGross: 0, monthInsurance: 0, monthTax: 0 });
    expect(full.insurance).toBe(1050);
    expect(full.tax).toBe(0); // 6000 - 1050 = 4950 < 5000 起征点
    expect(full.net).toBe(4950);

    const part = salaryBreakdown({ gross: 6000, partTime: true, monthGross: 0, monthInsurance: 0, monthTax: 0 });
    expect(part.insurance).toBe(0); // 兼职不缴五险一金，但个税仍按起征点计算
    expect(part.tax).toBe(30);
    expect(part.net).toBe(5970);
  });

  it('本月多笔收入累计计税（第二笔补扣差额）', () => {
    const first = salaryBreakdown({ gross: 6000, partTime: false, monthGross: 0, monthInsurance: 0, monthTax: 0 });
    const second = salaryBreakdown({
      gross: 6000, partTime: false,
      monthGross: 6000, monthInsurance: first.insurance, monthTax: first.tax,
    });
    // 累计应纳税所得额 = 12000 - 2100 - 5000 = 4900 → 个税 280
    expect(second.taxable).toBe(4900);
    expect(second.tax).toBe(280);
    expect(second.net).toBe(6000 - 1050 - 280);
  });

  it('monthNet 与 salaryBreakdown 的到手一致，且不会为负', () => {
    expect(monthNet(8000, 1400, 0)).toBe(6600);
    expect(monthNet(100, 200, 0)).toBe(0);
  });
});

describe('引擎接入：上班工资走税前/到手', () => {
  it('上班记入本月工资、扣五险一金，现金增加的是到手金额', () => {
    const s = employed('assistant');
    const before = s.player.money;
    const r = performWork(s, seededRng(7));
    expect(r.result.ok).toBe(true);
    const gross = r.state.player.monthGross;
    expect(gross).toBeGreaterThan(0);
    expect(r.state.player.monthInsurance).toBe(Math.round(gross * INSURANCE_RATE));
    expect(r.state.player.money - before).toBe(gross - r.state.player.monthInsurance - r.state.player.monthTax);
    expect(r.result.text).toContain('到手');
  });

  it('兼职不缴五险一金', () => {
    const s = employed('cashier');
    const r = performWork(s, seededRng(8));
    expect(r.state.player.monthInsurance).toBe(0);
  });

  it('月初输出上月工资明细并清零', () => {
    const s = beforeMonthStart(employed('assistant'));
    s.player.monthGross = 12000;
    s.player.monthInsurance = 2100;
    s.player.monthTax = 280;
    const r = endDay(s, seededRng(9));
    expect(r.state.morningReport.join(' ')).toContain('上月工资');
    expect(r.state.morningReport.join(' ')).toContain('到手 ¥9,620');
    expect(r.state.player.monthGross).toBe(0);
    expect(r.state.player.monthInsurance).toBe(0);
    expect(r.state.player.monthTax).toBe(0);
  });
});

describe('迁移：v9 → v10 工资明细字段', () => {
  it('老存档补 0，坏值清洗', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v9: Record<string, unknown> = { ...modern, version: 9 };
    const player = { ...(v9.player as Record<string, unknown>) };
    delete player.monthGross;
    delete player.monthInsurance;
    delete player.monthTax;
    v9.player = player;
    const s = migrate(v9);
    expect(s.player.monthGross).toBe(0);
    expect(s.player.monthInsurance).toBe(0);
    expect(s.player.monthTax).toBe(0);
    expect(s.version).toBe(CURRENT_VERSION);

    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 10;
    raw.player = { ...(raw.player as Record<string, unknown>), monthGross: -50, monthInsurance: 'x', monthTax: 12.6 };
    const cleaned = migrate(raw);
    expect(cleaned.player.monthGross).toBe(0);
    expect(cleaned.player.monthInsurance).toBe(0);
    expect(cleaned.player.monthTax).toBe(13);
  });
});