import { describe, expect, it } from 'vitest';
import { SKILL_KEYS } from '../content';
import { applyForJob, careerStatus, endDay, performActivity, performOvertime, performWork } from '../engine';
import { CURRENT_VERSION, migrate } from '../migrate';
import type { GameState } from '../types';
import { dateParts } from '../util';
import { cleanState, seededRng, startedGame } from './helpers';

/** 把状态推进到「本月最后一天」，下一次 endDay 触发月初绩效评估 */
function beforeMonthStart(s: GameState): GameState {
  const st = cleanState(s);
  while (dateParts(st.startISO, st.day + 1).d !== 1) st.day += 1;
  return st;
}

/** 造一个已入职、绩效与出勤可控的状态 */
function employedState(jobId: string, opts: { performance?: number; trackDays?: number; skills?: Partial<Record<string, number>>; workDays?: number } = {}): GameState {
  const s = cleanState(startedGame());
  const job = s.player.jobId;
  s.player.jobId = jobId;
  s.player.occupation = 'employed';
  s.player.workDays = opts.workDays ?? 200;
  s.player.lastReviewWorkDays = s.player.workDays - 20;
  s.player.performance = opts.performance ?? 60;
  s.player.trackDays = { service: opts.trackDays ?? 100, tech: opts.trackDays ?? 100, sales: opts.trackDays ?? 100, admin: opts.trackDays ?? 100, education: opts.trackDays ?? 100 };
  s.player.skills = { coding: 0, communication: 0, writing: 0, language: 0, ...(opts.skills ?? {}) };
  s.flags = {};
  return job ? s : s;
}

describe('技能成长', () => {
  it('学习行动提升对应技能', () => {
    const s = cleanState(startedGame());
    expect(s.player.skills.coding).toBe(0);
    const r = performActivity(s, 's_skill', seededRng(3));
    expect(r.result.ok).toBe(true);
    expect(r.state.player.skills.coding).toBeGreaterThan(0);
    expect(r.result.text).toContain('编程');
  });

  it('技能不超过 100 且为整数', () => {
    const s = cleanState(startedGame());
    s.player.skills.coding = 99;
    const r = performActivity(s, 's_skill', seededRng(4));
    expect(r.state.player.skills.coding).toBeLessThanOrEqual(100);
    expect(Number.isInteger(r.state.player.skills.coding)).toBe(true);
  });
});

describe('上班：行业资历、绩效与技能', () => {
  it('上班增加本行业天数、绩效与本职技能', () => {
    const s = employedState('cashier', { performance: 60, trackDays: 0, skills: {} });
    // cashier 是兼职，期望出勤较低不影响单次上涨
    const r = performWork(s, seededRng(5));
    expect(r.result.ok).toBe(true);
    expect(r.state.player.trackDays.service).toBe(1);
    expect(r.state.player.performance).toBe(61);
    expect(r.state.npcs.length).toBeGreaterThan(0);
  });

  it('加班额外提升绩效', () => {
    const s = employedState('assistant', { performance: 60 });
    s.todayCounts.work = 1;
    const r = performOvertime(s, seededRng(6));
    expect(r.result.ok).toBe(true);
    expect(r.state.player.performance).toBe(63);
  });

  it('careerStatus 暴露职业线、绩效与下一目标', () => {
    const s = employedState('cashier', { performance: 90, trackDays: 30, skills: { communication: 40 } });
    const c = careerStatus(s);
    expect(c.job?.id).toBe('cashier');
    expect(c.trackLabel).toBe('服务业');
    expect(c.skillLabel).toBe('沟通');
    expect(c.performance).toBe(90);
    expect(c.next?.id).toBe('shift_lead');
  });
});

describe('应聘条件：技能与行业资历', () => {
  it('技能不足时给出明确原因', () => {
    const s = cleanState(startedGame());
    s.player.occupation = 'unemployed';
    s.player.jobId = null;
    s.player.knowledge = 200;
    const r = applyForJob(s, 'intern_dev', seededRng(7));
    expect(r.result.ok).toBe(false);
    expect(r.result.text).toContain('编程');
  });

  it('满足条件后可应聘通过', () => {
    const s = cleanState(startedGame());
    s.player.occupation = 'unemployed';
    s.player.jobId = null;
    s.player.knowledge = 60;
    s.player.skills.coding = 20;
    const r = applyForJob(s, 'intern_dev', seededRng(8));
    expect(r.result.ok).toBe(true);
    // 兼职/全职概率不同，成功或面试失败都算合法；这里只要求不是条件不足
    expect(r.result.title).not.toBe('应聘被拒');
  });

  it('转行到不同职业线会因行业天数不足被卡住', () => {
    const s = cleanState(startedGame());
    s.player.jobId = 'cashier';
    s.player.occupation = 'employed';
    s.player.trackDays = { service: 100 };
    s.player.workDays = 100;
    s.player.knowledge = 200;
    s.player.skills.coding = 100;
    const r = applyForJob(s, 'junior_dev', seededRng(9));
    expect(r.result.ok).toBe(false);
    expect(r.result.text).toContain('本行业天数');
  });
});

describe('每月绩效评估：奖金 / 晋升 / PIP / 裁员', () => {
  it('绩效达到 80 发放绩效奖金', () => {
    const s = beforeMonthStart(employedState('assistant', { performance: 85 }));
    const before = s.player.money;
    const r = endDay(s, seededRng(10));
    const bonusTx = r.state.transactions.find((t) => t.note.startsWith('绩效奖金'));
    expect(bonusTx).toBeDefined();
    expect(bonusTx!.amount).toBe(90); // assistant 工资 300 × 30%
    expect(r.state.player.money).toBeGreaterThan(before - 1600); // 还有房租/日常开销
    expect(r.state.morningReport.join(' ')).toContain('绩效奖金');
  });

  it('连续两个月优秀且条件满足则自动晋升', () => {
    let s = beforeMonthStart(employedState('cashier', { performance: 90, trackDays: 100, skills: { communication: 60 } }));
    s = endDay(s, seededRng(11)).state;
    expect(s.player.jobId).toBe('cashier'); // 第一次只记录优秀
    expect(s.flags.perfHigh).toBe(1);
    // 新的一月继续出勤（工作天数 +20），第二次评估才够晋升
    s = beforeMonthStart(s);
    s.player.workDays += 20;
    s = endDay(s, seededRng(11)).state;
    expect(s.player.jobId).toBe('shift_lead');
    expect(s.flags.promotions).toBe(1);
    expect(s.morningReport.join(' ')).toContain('晋升');
  });

  it('连续低绩效会收到 PIP 警告', () => {
    let s = beforeMonthStart(employedState('assistant', { performance: 10 }));
    s = endDay(s, seededRng(12)).state;
    s = beforeMonthStart(s);
    s = { ...s, player: { ...s.player, performance: 10 } };
    s = endDay(s, seededRng(12)).state;
    expect(s.morningReport.join(' ')).toContain('PIP');
    expect(s.player.jobId).toBe('assistant');
  });

  it('连续三个月低绩效会被裁员', () => {
    let s = beforeMonthStart(employedState('assistant', { performance: 10 }));
    for (let i = 0; i < 3; i++) {
      s = beforeMonthStart({ ...s, player: { ...s.player, performance: 10 } });
      s = endDay(s, seededRng(13)).state;
    }
    expect(s.player.jobId).toBeNull();
    expect(s.player.occupation).toBe('unemployed');
    expect(s.flags.laidOffDay).toBeTypeOf('number');
  });
});

describe('迁移：v3 → v4 职业字段', () => {
  it('老存档补齐技能 / 绩效 / 行业天数', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v3: Record<string, unknown> = { ...modern, version: 3 };
    const player = { ...(v3.player as Record<string, unknown>) };
    delete player.skills;
    delete player.trackDays;
    delete player.performance;
    delete player.lastReviewWorkDays;
    player.jobId = 'specialist';
    player.workDays = 50;
    v3.player = player;

    const s = migrate(v3);
    expect(s.version).toBe(CURRENT_VERSION);
    expect(s.player.skills).toEqual({ coding: 0, communication: 0, writing: 0, language: 0 });
    expect(s.player.trackDays).toEqual({ sales: 50 });
    expect(s.player.performance).toBe(60);
    expect(s.player.lastReviewWorkDays).toBe(50);
  });

  it('坏掉的职业数据被清洗', () => {
    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 4;
    const player = { ...(raw.player as Record<string, unknown>) };
    player.skills = { coding: 999, communication: -5 };
    player.trackDays = { service: -10, tech: 'x', sales: 12 };
    player.performance = 500;
    raw.player = player;
    const s = migrate(raw);
    expect(s.player.skills.coding).toBe(100);
    expect(s.player.skills.communication).toBe(0);
    expect(s.player.skills.writing).toBe(0);
    expect(s.player.trackDays).toEqual({ sales: 12 });
    expect(s.player.performance).toBe(100);
    for (const k of SKILL_KEYS) expect(Number.isInteger(s.player.skills[k])).toBe(true);
  });

  it('新游戏带完整职业字段', () => {
    const s = cleanState(startedGame());
    expect(s.player.skills).toEqual({ coding: 0, communication: 0, writing: 0, language: 0 });
    expect(s.player.trackDays).toEqual({});
    expect(s.player.performance).toBe(60);
  });
});