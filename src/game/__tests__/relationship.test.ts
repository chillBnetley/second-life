import { describe, expect, it } from 'vitest';
import { confess, endDay, interactWithNpc, relationshipStatus } from '../engine';
import { STAGE_META, stageForAffinity } from '../npcs';
import { CURRENT_VERSION, migrate } from '../migrate';
import { cleanState, seededRng, startedGame } from './helpers';

const successRng = () => 0;      // 必定成功
const failRng = () => 0.999;     // 必定失败

function romanceState(): ReturnType<typeof startedGame> {
  const s = cleanState(startedGame());
  const x = s.npcs.find((n) => n.id === 'xiaoxia')!;
  x.met = true;
  x.affinity = 70;
  x.trust = 20;
  x.stage = stageForAffinity(x.affinity);
  s.player.attrs.charm = 60;
  return s;
}

describe('关系阶段推导', () => {
  it('好感阈值映射到阶段', () => {
    expect(stageForAffinity(-10)).toBe('stranger');
    expect(stageForAffinity(19)).toBe('stranger');
    expect(stageForAffinity(20)).toBe('acquaintance');
    expect(stageForAffinity(45)).toBe('friend');
    expect(stageForAffinity(62)).toBe('close');
    expect(stageForAffinity(90)).toBe('best');
    expect(STAGE_META.close.label).toBe('好友');
  });

  it('初始 NPC 自带推导后的阶段与信任', () => {
    const s = cleanState(startedGame());
    const mom = s.npcs.find((n) => n.id === 'mom')!;
    expect(mom.stage).toBe(stageForAffinity(mom.affinity));
    expect(mom.trust).toBe(0);
    expect(mom.romanceable).toBe(false);
    expect(s.npcs.find((n) => n.id === 'xiaoxia')!.romanceable).toBe(true);
  });
});

describe('互动：信任与阶段变化', () => {
  it('好的互动会增加信任，坏结果会减少', () => {
    const base = cleanState(startedGame());
    const mom = base.npcs.find((n) => n.id === 'mom')!;
    mom.trust = 0;
    const ok = interactWithNpc(base, 'mom', 'gift', seededRng(3));
    expect(ok.result.ok).toBe(true);
    const after = ok.state.npcs.find((n) => n.id === 'mom')!;
    expect(after.trust).toBeGreaterThanOrEqual(0);
  });

  it('好感跨过阈值时阶段升级并写日志', () => {
    const s = cleanState(startedGame());
    const mom = s.npcs.find((n) => n.id === 'mom')!;
    mom.affinity = 39;
    mom.stage = stageForAffinity(39);
    expect(mom.stage).toBe('acquaintance');
    let next = s;
    // 反复送礼直到跨过 40（礼物固定 +5 左右，一次就够）
    for (let i = 0; i < 3 && next.npcs.find((n) => n.id === 'mom')!.affinity < 40; i++) {
      const r = interactWithNpc(next, 'mom', 'gift', seededRng(10 + i));
      expect(r.result.ok).toBe(true);
      next = r.state;
    }
    const after = next.npcs.find((n) => n.id === 'mom')!;
    expect(after.stage).toBe('friend');
    expect(next.log.some((l) => l.title.includes('关系升温'))).toBe(true);
  });
});

describe('表白与恋爱线', () => {
  it('不可发展恋爱线的人无法表白', () => {
    const s = cleanState(startedGame());
    expect(confess(s, 'mom', successRng).result.ok).toBe(false);
  });

  it('好感不足 50 时被拒绝并说明原因', () => {
    const s = romanceState();
    s.npcs.find((n) => n.id === 'xiaoxia')!.affinity = 40;
    const r = confess(s, 'xiaoxia', successRng);
    expect(r.result.ok).toBe(false);
    expect(r.result.text).toContain('好感');
  });

  it('成功表白建立恋人关系', () => {
    const s = romanceState();
    const r = confess(s, 'xiaoxia', successRng);
    expect(r.result.ok).toBe(true);
    expect(r.state.flags.partner_xiaoxia).toBeDefined();
    expect(r.state.npcs.find((n) => n.id === 'xiaoxia')!.mood).toBe('happy');
    expect(r.state.player.attrs.happiness).toBeGreaterThanOrEqual(s.player.attrs.happiness);
    expect(relationshipStatus(r.state, 'xiaoxia').partner).toBe(true);
    expect(r.state.log.some((l) => l.title === '表白成功')).toBe(true);
  });

  it('失败表白降低好感并留下记忆', () => {
    const s = romanceState();
    const before = s.npcs.find((n) => n.id === 'xiaoxia')!.affinity;
    const r = confess(s, 'xiaoxia', failRng);
    expect(r.result.ok).toBe(true);
    expect(r.result.title).toBe('表白未成功');
    const after = r.state.npcs.find((n) => n.id === 'xiaoxia')!;
    expect(after.affinity).toBeLessThan(before);
    expect(after.memories.some((m) => m.text.includes('婉拒'))).toBe(true);
    expect(r.state.flags.partner_xiaoxia).toBeUndefined();
  });

  it('好感跌到 15 以下会分手', () => {
    const s = romanceState();
    const partnered = confess(s, 'xiaoxia', successRng).state;
    const cold = { ...partnered, player: { ...partnered.player } };
    cold.npcs = cold.npcs.map((n) => (n.id === 'xiaoxia' ? { ...n, affinity: 5 } : n));
    const r = endDay({ ...cold, pendingEvent: null, ap: cold.maxAp }, seededRng(21));
    expect(r.state.flags.partner_xiaoxia).toBeUndefined();
    expect(r.state.morningReport.join(' ')).toContain('分开');
  });
});

describe('迁移：v4 → v5 关系字段', () => {
  it('老存档补齐信任 / 阶段 / 恋爱标记', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v4: Record<string, unknown> = { ...modern, version: 4 };
    v4.npcs = (v4.npcs as Record<string, unknown>[]).map((n) => {
      const copy = { ...n };
      delete copy.trust;
      delete copy.stage;
      delete copy.romanceable;
      return copy;
    });
    const s = migrate(v4);
    expect(s.version).toBe(CURRENT_VERSION);
    const mom = s.npcs.find((n) => n.id === 'mom')!;
    expect(mom.trust).toBe(0);
    expect(mom.stage).toBe(stageForAffinity(mom.affinity));
    expect(mom.romanceable).toBe(false);
    expect(s.npcs.find((n) => n.id === 'xiaoxia')!.romanceable).toBe(true);
  });

  it('越界信任被夹紧', () => {
    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 5;
    raw.npcs = (raw.npcs as Record<string, unknown>[]).map((n) => (n.id === 'mom' ? { ...n, trust: 999 } : n));
    const s = migrate(raw);
    expect(s.npcs.find((n) => n.id === 'mom')!.trust).toBe(100);
  });
});