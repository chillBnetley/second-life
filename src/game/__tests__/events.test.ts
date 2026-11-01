import { describe, expect, it } from 'vitest';
import { ATTR_KEYS, MAX_ATTR_DELTA, MAX_MONEY_DELTA } from '../content';
import { EVENT_DEFS, instantiateEvent, isEligible } from '../events';
import { EVENT_LIMITS } from '../validate';
import type { GameState } from '../types';
import { cleanState, seededRng, startedGame } from './helpers';

describe('事件模板完整性（82 个模板的结构约定）', () => {
  it('id 唯一', () => {
    const ids = EVENT_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个事件都有合法标题、描述与 2~4 个选项', () => {
    for (const d of EVENT_DEFS) {
      expect(d.title.length, `${d.id} 标题长度`).toBeGreaterThanOrEqual(2);
      expect(d.title.length, `${d.id} 标题长度`).toBeLessThanOrEqual(30);
      expect(d.description.length, `${d.id} 描述长度`).toBeGreaterThanOrEqual(8);
      expect(d.choices.length, `${d.id} 选项数量`).toBeGreaterThanOrEqual(2);
      expect(d.choices.length, `${d.id} 选项数量`).toBeLessThanOrEqual(4);
      for (const c of d.choices) {
        expect(c.label.length, `${d.id}/${c.id} 选项文案`).toBeGreaterThanOrEqual(1);
        expect(c.label.length, `${d.id}/${c.id} 选项文案`).toBeLessThanOrEqual(40);
        expect(c.outcomes.length, `${d.id}/${c.id} 结果数量`).toBeGreaterThanOrEqual(1);
        expect(c.outcomes.length, `${d.id}/${c.id} 结果数量`).toBeLessThanOrEqual(3);
        if (c.check) expect(c.outcomes.length, `${d.id} 检定选项需要成功/失败两个结果`).toBeGreaterThanOrEqual(2);
        for (const out of c.outcomes) {
          expect(out.text.length, `${d.id} 结果文案`).toBeGreaterThanOrEqual(1);
          expect(out.text.length, `${d.id} 结果文案`).toBeLessThanOrEqual(240);
          expect(out.weight, `${d.id} 结果权重`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('每个事件至少有一个不需要花钱的选项（防止负债玩家卡死）', () => {
    for (const d of EVENT_DEFS) {
      const free = d.choices.some((c) => !c.cost || c.cost <= 0);
      expect(free, `${d.id} 的所有选项都要钱`).toBe(true);
    }
  });

  it('事件数值不超过引擎的硬上限（本地事件允许比 AI 事件更大幅度的设计）', () => {
    for (const d of EVENT_DEFS) {
      for (const c of d.choices) {
        if (c.cost !== undefined) expect(c.cost, `${d.id} 选择费用`).toBeLessThanOrEqual(3000);
        for (const out of c.outcomes) {
          for (const k of ATTR_KEYS) {
            const v = out.effects.attrs?.[k];
            if (v !== undefined) expect(Math.abs(v), `${d.id}/${c.id} ${k}`).toBeLessThanOrEqual(MAX_ATTR_DELTA);
          }
          if (out.effects.money !== undefined) {
            expect(out.effects.money, `${d.id} 金钱收益`).toBeLessThanOrEqual(MAX_MONEY_DELTA);
            expect(out.effects.money, `${d.id} 金钱损失`).toBeGreaterThanOrEqual(-MAX_MONEY_DELTA);
          }
          if (out.effects.knowledge !== undefined) expect(out.effects.knowledge, `${d.id} 学识`).toBeLessThanOrEqual(30);
          for (const ne of out.effects.npc ?? []) {
            if (ne.affinity !== undefined) expect(Math.abs(ne.affinity), `${d.id} 好感`).toBeLessThanOrEqual(15);
          }
        }
      }
    }
    // AI 事件的上限比本地更严格，确认两者不是同一套常量
    expect(EVENT_LIMITS.attr).toBeLessThan(MAX_ATTR_DELTA);
  });

  it('用到 {npc} 占位符的事件必须声明 npc 条件', () => {
    for (const d of EVENT_DEFS) {
      const usesPlaceholder = d.title.includes('{npc}') || d.description.includes('{npc}');
      if (usesPlaceholder) expect(d.npc, `${d.id} 使用了 {npc} 但没有 npc 条件`).toBeTruthy();
    }
  });

  it('实例化后是可序列化的纯数据，占位符被替换', () => {
    const rng = seededRng(99);
    const s = cleanState(startedGame());
    for (const n of s.npcs) { n.met = true; n.affinity = 60; }
    let checked = 0;
    for (const d of EVENT_DEFS) {
      if (!isEligible(d, s)) continue;
      const ev = instantiateEvent(d, s, rng);
      expect(ev, `${d.id} 无法实例化`).not.toBeNull();
      if (!ev) continue;
      checked++;
      expect(JSON.parse(JSON.stringify(ev))).toEqual(ev);
      expect(ev.title).not.toContain('{npc}');
      expect(ev.description).not.toContain('{npc}');
      expect(ev.source).toBe('local');
      expect(ev.defId).toBe(d.id);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('事件链：前置事件发生过之后才可触发', () => {
    const chain = EVENT_DEFS.find((d) => d.id === 'mentor_recommend')!;
    const s = cleanState(startedGame());
    expect(isEligible(chain, s)).toBe(false);
    const later: GameState = { ...s, day: s.day + 30, seenEvents: { mentor_project: s.day } };
    expect(isEligible(chain, later)).toBe(true);
  });

  it('季节事件只在对应月份可触发', () => {
    const spring = EVENT_DEFS.find((d) => d.id === 'spring_festival')!;
    const base = cleanState(startedGame());
    // 2026-09-01 不是 2 月；推到次年 2 月
    const feb = { ...base, day: base.day + 160 };
    expect(isEligible(spring, base)).toBe(false);
    expect(isEligible(spring, feb)).toBe(true);
  });
});