import { describe, expect, it } from 'vitest';
import { LIFE_STAGES, RETIRE_AGE, lifeScore, lifeStageFor } from '../life';
import { dismissLifeEnd, endDay } from '../engine';
import { cleanState, seededRng, startedGame } from './helpers';

function withBirth(birthISO: string, seed = 7) {
  const s = cleanState(startedGame(seed));
  s.player.birthISO = birthISO;
  return s;
}

describe('人生阶段状态机', () => {
  it('年龄映射到正确阶段', () => {
    expect(lifeStageFor(18).key).toBe('study');
    expect(lifeStageFor(22).key).toBe('study');
    expect(lifeStageFor(23).key).toBe('career');
    expect(lifeStageFor(29).key).toBe('career');
    expect(lifeStageFor(30).key).toBe('family');
    expect(lifeStageFor(44).key).toBe('family');
    expect(lifeStageFor(45).key).toBe('harvest');
    expect(lifeStageFor(59).key).toBe('harvest');
    expect(lifeStageFor(60).key).toBe('retire');
    expect(lifeStageFor(85).key).toBe('retire');
    expect(RETIRE_AGE).toBe(60);
  });

  it('阶段定义连续且字段完整', () => {
    expect(LIFE_STAGES.length).toBe(5);
    for (let i = 1; i < LIFE_STAGES.length; i++) expect(LIFE_STAGES[i].from).toBe(LIFE_STAGES[i - 1].to + 1);
    for (const st of LIFE_STAGES) {
      expect(st.label.length).toBeGreaterThan(1);
      expect(st.desc.length).toBeGreaterThan(5);
      expect(st.emoji).toBeTruthy();
    }
  });

  it('跨过年龄节点时写日志并更新阶段标记', () => {
    const s = withBirth('2003-09-01'); // 开局正好 23 岁，跳过学业期
    const r = endDay(s, seededRng(3));
    expect(r.result.ok).toBe(true);
    expect(r.state.flags.lifeStage).toBe('career');
    expect(r.state.morningReport.join(' ')).toContain('立业阶段');
    expect(r.state.log.some((l) => l.title.includes('人生阶段') && l.importance === 3)).toBe(true);
    // 同阶段内不再重复播报（先清掉可能触发的清晨事件）
    const r2 = endDay({ ...r.state, pendingEvent: null }, seededRng(4));
    expect(r2.state.morningReport.join(' ')).not.toContain('立业阶段');
  });

  it('60 岁触发终局标记，可关闭提示', () => {
    const s = withBirth('1966-09-01'); // 开局正好 60 岁
    s.flags.lifeStage = 'harvest';
    const r = endDay(s, seededRng(5));
    expect(r.state.flags.lifeStage).toBe('retire');
    expect(typeof r.state.flags.lifeEnded).toBe('number');
    expect(r.state.morningReport.join(' ')).toContain('回望这一生');

    const dismissed = dismissLifeEnd(r.state);
    expect(dismissed.result.ok).toBe(true);
    expect(dismissed.state.flags.lifeEndedSeen).toBe(r.state.flags.lifeEnded);
    expect(dismissLifeEnd(dismissed.state).result.ok).toBe(false);
    expect(dismissLifeEnd(s).result.ok).toBe(false); // 未到终局时不可关闭
  });
});

describe('人生评分', () => {
  it('总分等于各项之和（允许四舍五入误差），且在 0~100', () => {
    const s = cleanState(startedGame());
    const score = lifeScore(s);
    const sum = score.parts.reduce((a, p) => a + p.score, 0);
    expect(Math.abs(sum - score.total)).toBeLessThanOrEqual(1);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.parts.length).toBe(6);
    for (const p of score.parts) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(p.max);
      expect(p.detail.length).toBeGreaterThan(0);
    }
    expect(score.title.length).toBeGreaterThan(0);
  });

  it('属性、财富、关系更好时分数更高', () => {
    const base = cleanState(startedGame());
    const before = lifeScore(base).total;
    const boosted = cleanState(startedGame());
    boosted.player.attrs = { intelligence: 90, eq: 90, fitness: 90, charm: 90, happiness: 95, health: 95 };
    boosted.player.money = 300000;
    boosted.player.knowledge = 200;
    boosted.player.skills = { coding: 90, communication: 90, writing: 90, language: 90 };
    boosted.player.jobId = 'tech_lead';
    boosted.player.occupation = 'employed';
    boosted.player.performance = 95;
    boosted.npcs = boosted.npcs.map((n) => ({ ...n, met: true, affinity: 85 }));
    boosted.flags.partner_xiaoxia = boosted.day;
    const after = lifeScore(boosted).total;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(60);
  });

  it('与阶段无关，只读状态（不修改存档）', () => {
    const s = cleanState(startedGame());
    const snapshot = JSON.stringify(s);
    lifeScore(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});