import { describe, expect, it } from 'vitest';
import { endDay } from '../engine';
import { playDay, invariants, runDays, seededRng, startedGame } from './helpers';

describe('规则引擎不变量', () => {
  it('随机游玩 400 回合后所有不变量仍然成立', () => {
    const rng = seededRng(2024);
    let s = startedGame(2024);
    const target = s.day + 400;
    let rounds = 0;
    while (s.day < target && rounds++ < 1600) {
      s = playDay(s, rng).state;
      expect(invariants(s), `第 ${s.day} 天行动后`).toEqual([]);
      if (s.pendingEvent) continue;
      const r = endDay(s, rng);
      expect(r.result.ok, r.result.text).toBe(true);
      s = r.state;
      expect(invariants(s), `第 ${s.day} 天结算后`).toEqual([]);
    }
    expect(s.day).toBe(target);
  });

  it('行动点永远不会被扣成负数', () => {
    const rng = seededRng(777);
    let s = startedGame(777);
    for (let i = 0; i < 120; i++) {
      s = playDay(s, rng).state;
      expect(s.ap).toBeGreaterThanOrEqual(0);
      expect(s.ap).toBeLessThanOrEqual(s.maxAp);
      if (s.pendingEvent) continue;
      const r = endDay(s, rng);
      s = r.state;
    }
  });
});

describe('黄金快照：同种子必须复现同一结果', () => {
  it('120 天两次运行的结果完全一致', () => {
    const run = () => runDays(startedGame(99), 120, seededRng(99));
    const a = run();
    const b = run();
    expect(a.day).toBe(b.day);
    expect(a.player.money).toBe(b.player.money);
    expect(a.player.attrs).toEqual(b.player.attrs);
    expect(a.player.knowledge).toBe(b.player.knowledge);
    expect(a.npcs.map((n) => n.affinity)).toEqual(b.npcs.map((n) => n.affinity));
  });

  it('120 天的关键指标落在合理区间（防止平衡被无意改坏）', () => {
    const s = runDays(startedGame(99), 120, seededRng(99));
    expect(s.day).toBeGreaterThanOrEqual(118);
    for (const [k, v] of Object.entries(s.player.attrs)) {
      expect(v, k).toBeGreaterThanOrEqual(15);
      expect(v, k).toBeLessThanOrEqual(100);
    }
    expect(s.player.money).toBeGreaterThan(-200000);
    expect(s.player.money).toBeLessThan(500000);
    expect(s.player.knowledge).toBeGreaterThan(0);
    expect(Object.keys(s.achievements).length).toBeGreaterThanOrEqual(1);
    expect(s.log.length).toBeLessThanOrEqual(700);
  });
});
