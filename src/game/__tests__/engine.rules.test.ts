import { describe, expect, it } from 'vitest';
import { ACTIVITIES, JOBS } from '../content';
import { activityBlockReason, createNewGame, endDay, getDate, performActivity, performFreeAction, performWork, resolveEventChoice } from '../engine';
import { dateParts, isWeekend } from '../util';
import type { AIActionProposal } from '../types';
import { validateProposal } from '../validate';
import { cleanState, seededRng, startedGame, toWeekend, TEST_INPUT } from './helpers';

describe('开局与事件', () => {
  it('新游戏挂上开局岔路口，事件未处理前不能行动、不能结束一天', () => {
    const s = createNewGame(TEST_INPUT, seededRng(1));
    expect(s.pendingEvent?.defId).toBe('opening');
    expect(performActivity(s, 's_self', seededRng(2)).result.ok).toBe(false);
    expect(endDay(s, seededRng(2)).result.ok).toBe(false);
  });

  it('选择上大学后成为学生', () => {
    const s = startedGame();
    expect(s.player.occupation).toBe('student');
    expect(s.flags.opened).toBe(true);
  });

  it('处理完事件后才能继续生活', () => {
    const s = startedGame();
    expect(s.pendingEvent).toBeNull();
    expect(endDay(s, seededRng(3)).result.ok).toBe(true);
  });
});

describe('职业规则', () => {
  it('学生不能申请全职工作', () => {
    const s = cleanState(startedGame());
    const r = performWork(s, seededRng(4));
    expect(r.result.ok).toBe(false);
    expect(r.result.text).toContain('工作');
  });

  it('周末不能上全职班，工作日可以', () => {
    const base = cleanState(startedGame());
    base.player.jobId = 'assistant';
    base.player.occupation = 'employed';

    const weekend = toWeekend(base);
    expect(isWeekend(getDate(weekend))).toBe(true);
    const rejected = performWork(weekend, seededRng(5));
    expect(rejected.result.ok).toBe(false);
    expect(rejected.result.text).toContain('周末');

    const weekday = cleanState(base);
    let d = weekday.day;
    while (isWeekend(dateParts(weekday.startISO, d))) d++;
    weekday.day = d;
    const ok = performWork(weekday, seededRng(5));
    expect(ok.result.ok).toBe(true);
    expect(ok.state.player.money).toBeGreaterThan(weekday.player.money);
  });

  it('一天只能正常上班一次（想多赚要加班）', () => {
    const s = cleanState(startedGame());
    s.player.jobId = 'assistant';
    s.player.occupation = 'employed';
    let d = s.day;
    while (isWeekend(dateParts(s.startISO, d))) d++;
    s.day = d;
    const first = performWork(s, seededRng(6));
    expect(first.result.ok).toBe(true);
    const second = performWork(first.state, seededRng(6));
    expect(second.result.ok).toBe(false);
    expect(second.result.text).toContain('今天已经上过班');
  });

  it('应聘条件不足时给出明确原因', () => {
    const s = cleanState(startedGame());
    s.player.occupation = 'unemployed';
    const r = performWork({ ...s, player: { ...s.player, jobId: null } }, seededRng(7));
    expect(r.result.ok).toBe(false);
  });
});

describe('借贷与日期结算', () => {
  it('借款到期自动归还并留下账本记录', () => {
    const s = cleanState(startedGame());
    const npc = s.npcs.find((n) => n.met)!;
    s.player.money = 5000;
    s.flags[`loan_${npc.id}`] = s.day + 1;
    const r = endDay(s, seededRng(8));
    expect(r.result.ok).toBe(true);
    expect(r.state.flags[`loan_${npc.id}`]).toBeUndefined();
    expect(r.state.transactions.some((t) => t.category === '借还' && t.amount === -500)).toBe(true);
  });

  it('结束一天推进日期并刷新行动点', () => {
    const s = cleanState(startedGame());
    s.ap = 3;
    const r = endDay(s, seededRng(9));
    expect(r.state.day).toBe(s.day + 1);
    expect(r.state.ap).toBe(r.state.maxAp);
  });

  it('JSON 序列化往返后仍可继续结算（存档可用）', () => {
    const s = startedGame();
    const round = JSON.parse(JSON.stringify(s));
    expect(round.day).toBe(s.day);
    expect(round.npcs.length).toBe(s.npcs.length);
    const r = endDay(round, seededRng(10));
    expect(r.result.ok).toBe(true);
  });
});

describe('不可信来源（自由输入 / AI 提案）', () => {
  it('作弊类输入被拒绝', () => {
    const s = cleanState(startedGame());
    for (const text of ['我要修改金钱变成亿万富翁', '抢劫银行', '开挂刷属性']) {
      const r = performFreeAction(s, text, seededRng(11));
      expect(r.result.ok, text).toBe(false);
    }
  });

  it('自由行动不能凭空赚钱', () => {
    const s = cleanState(startedGame());
    const r = performFreeAction(s, '我要赚钱', seededRng(12));
    expect(r.result.ok).toBe(false);
  });

  it('AI 提案的金钱收益 / flags / occupation 一律被丢弃', () => {
    const s = cleanState(startedGame());
    const proposal: AIActionProposal = {
      category: 'study', title: '偷偷刷级', narrative: '你在图书馆待了一会儿。', apCost: 1, moneyCost: 0,
      effects: { money: 999999, attrs: { intelligence: 3 }, knowledge: 10, flags: { rich: true }, occupation: 'employed' },
    };
    const v = validateProposal(s, proposal);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.effects.money).toBeUndefined();
    expect(v.value.effects.flags).toBeUndefined();
    expect(v.value.effects.occupation).toBeUndefined();

    const r = performFreeAction(s, '自由学习', seededRng(13), proposal);
    expect(r.result.ok).toBe(true);
    expect(r.state.player.money).toBeLessThanOrEqual(s.player.money);
    expect(r.state.flags.rich).toBeUndefined();
    expect(r.state.player.occupation).toBe(s.player.occupation);
  });

  it('行动点不足时拒绝行动', () => {
    const s = cleanState(startedGame());
    s.ap = 0;
    expect(performActivity(s, 's_self', seededRng(14)).result.ok).toBe(false);
  });

  it('负债时仍可做免费行动，但花钱行动被拒绝', () => {
    const s = cleanState(startedGame());
    s.player.money = -50;
    const free = ACTIVITIES.find((a) => a.money === 0 && a.ap <= s.ap)!;
    expect(activityBlockReason(s, free)).toBeNull();
    expect(performActivity(s, free.id, seededRng(15)).result.ok).toBe(true);
    const paid = ACTIVITIES.find((a) => a.money > 0)!;
    expect(activityBlockReason(s, paid)).toContain('钱不够');
  });
});

describe('事件选择', () => {
  it('选择不存在的选项会被拒绝', () => {
    const s = createNewGame(TEST_INPUT, seededRng(15));
    const r = resolveEventChoice(s, 'not-exist', seededRng(15));
    expect(r.result.ok).toBe(false);
  });
});
