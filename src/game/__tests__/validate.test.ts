import { describe, expect, it } from 'vitest';
import type { AIActionProposal } from '../types';
import { ACTION_LIMITS, EVENT_LIMITS, checkChance, sanitizeEffects, validateEventProposal, validateProposal } from '../validate';
import { cleanState, startedGame } from './helpers';

describe('sanitizeEffects：只保留已知字段并夹紧', () => {
  const s = cleanState(startedGame());

  it('丢弃 flags / occupation / ap，并夹紧属性与金钱', () => {
    const fx = sanitizeEffects({
      attrs: { intelligence: 999, eq: -999, happiness: '不存在' },
      money: 5000, knowledge: -10, ap: 5, flags: { hacked: true }, occupation: 'employed',
    }, ACTION_LIMITS, s);
    expect(fx.attrs?.intelligence).toBe(ACTION_LIMITS.attr);
    expect(fx.attrs?.eq).toBe(-ACTION_LIMITS.attr);
    expect(fx.attrs?.happiness).toBeUndefined();
    expect(fx.money).toBeUndefined(); // 自由行动不允许直接赚钱
    expect(fx.knowledge).toBeUndefined(); // 负数知识被丢弃
    expect(fx.ap).toBeUndefined();
    expect(fx.flags).toBeUndefined();
    expect(fx.occupation).toBeUndefined();
  });

  it('只接受已结识的 NPC，并夹紧好感度', () => {
    const met = s.npcs.find((n) => n.met)!;
    const unmet = s.npcs.find((n) => !n.met);
    const fx = sanitizeEffects({
      npc: [{ id: met.id, affinity: 999, memory: '记录' }, { id: unmet?.id ?? 'nobody', affinity: 5 }],
    }, ACTION_LIMITS, s);
    expect(fx.npc?.length).toBe(1);
    expect(fx.npc?.[0].affinity).toBe(ACTION_LIMITS.affinity);
  });

  it('事件限额比行动限额更宽松，但仍被夹紧', () => {
    const fx = sanitizeEffects({ attrs: { intelligence: 999 }, money: 999999, knowledge: 999 }, EVENT_LIMITS, s);
    expect(fx.attrs?.intelligence).toBe(EVENT_LIMITS.attr);
    expect(fx.money).toBe(EVENT_LIMITS.moneyGainMax);
    expect(fx.knowledge).toBe(EVENT_LIMITS.knowledge);
  });

  it('非对象输入返回空效果', () => {
    expect(sanitizeEffects(null, ACTION_LIMITS, s)).toEqual({});
    expect(sanitizeEffects('abc', ACTION_LIMITS, s)).toEqual({});
    expect(sanitizeEffects([1, 2], ACTION_LIMITS, s)).toEqual({});
  });
});

describe('validateProposal：AI 行动提案', () => {
  const s = cleanState(startedGame());
  const base: AIActionProposal = { category: 'study', title: '读书', narrative: '你读了一会儿书。', apCost: 2, moneyCost: 10, effects: { attrs: { intelligence: 2 } } };

  it('合法提案通过并保留结构', () => {
    const v = validateProposal(s, { ...base, moneyCost: 0 });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.apCost).toBe(2);
      expect(v.value.title).toBe('读书');
      expect(v.value.effects.attrs?.intelligence).toBeCloseTo(2);
    }
  });

  it('拒绝不支持的类别、非法耗时、负花费与超额花费', () => {
    expect(validateProposal(s, { ...base, category: 'crime' as never }).ok).toBe(false);
    expect(validateProposal(s, { ...base, apCost: 0 }).ok).toBe(false);
    expect(validateProposal(s, { ...base, apCost: 9 }).ok).toBe(false);
    expect(validateProposal(s, { ...base, moneyCost: -5 }).ok).toBe(false);
    expect(validateProposal(s, { ...base, moneyCost: s.player.money + 1 }).ok).toBe(false);
  });

  it('拒绝超出剩余行动点的提案', () => {
    const poor = { ...s, ap: 1 };
    expect(validateProposal(poor, { ...base, apCost: 3 }).ok).toBe(false);
  });

  it('总正收益与耗时挂钩（防止一小时变超人）', () => {
    const v = validateProposal(s, {
      ...base, apCost: 1, moneyCost: 0,
      effects: { attrs: { intelligence: 4, eq: 4, charm: 4, fitness: 4 } },
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const positive = Object.values(v.value.effects.attrs ?? {}).reduce((a, b) => a + (b && b > 0 ? b : 0), 0);
    expect(positive).toBeLessThanOrEqual(2.5 * 1 + 2 + 1e-6);
  });

  it('学识收益被限制在 3×AP', () => {
    const v = validateProposal(s, { ...base, apCost: 2, moneyCost: 0, effects: { knowledge: 999 } });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.effects.knowledge).toBeLessThanOrEqual(6);
  });
});

describe('checkChance：属性检定概率', () => {
  it('属性与目标相同时约 50%，并夹在 10%~95%', () => {
    expect(checkChance(50, 50)).toBeCloseTo(0.5);
    expect(checkChance(0, 100)).toBeCloseTo(0.1);
    expect(checkChance(100, 0)).toBeCloseTo(0.95);
  });
});

describe('validateEventProposal：AI 事件提案', () => {
  const s = cleanState(startedGame());
  const valid = {
    title: '雨天的伞',
    description: '傍晚突然下起大雨，你只有一把伞，教室门口站着一个没带伞的同学。',
    category: 'daily',
    choices: [
      { label: '把伞借给 TA', outcomes: [{ text: '对方愣了一下，接过伞时脸红了。', effects: { attrs: { eq: 2 } } }] },
      { label: '冒雨跑回去', outcomes: [{ text: '你冲进雨里，回到宿舍时全身湿透。', effects: { attrs: { health: -1 } } }] },
    ],
  };

  it('合法事件被接受，且可序列化', () => {
    const ev = validateEventProposal(s, valid);
    expect(ev).not.toBeNull();
    expect(ev?.source).toBe('ai');
    expect(ev?.choices.length).toBe(2);
    expect(JSON.parse(JSON.stringify(ev))).toEqual(ev);
  });

  it('拒绝垃圾输入', () => {
    expect(validateEventProposal(s, null)).toBeNull();
    expect(validateEventProposal(s, 'text')).toBeNull();
    expect(validateEventProposal(s, { title: 'x', description: '太短', choices: [] })).toBeNull();
    expect(validateEventProposal(s, { ...valid, choices: [] })).toBeNull();
  });

  it('越界数值被夹紧，选项与结果数量被裁剪', () => {
    const evil = {
      title: '恶意事件',
      description: '这是一段足够长的描述文本，用来测试校验层是否会夹紧来自模型的越界数值。',
      category: 'random',
      choices: [
        {
          label: '白拿钱',
          cost: 999999,
          check: { attr: 'intelligence', target: 999 },
          outcomes: [
            { text: '你凭空得到了巨款。', effects: { attrs: { intelligence: 999 }, money: 9999999, knowledge: 999, flags: { rich: true } } },
            { text: '什么都没发生。' },
            { text: '第三个结果。' },
            { text: '第四个结果。' },
          ],
        },
        { label: '选项二', outcomes: [{ text: '平淡的一天。' }] },
        { label: '选项三', outcomes: [{ text: '平淡的一天。' }] },
        { label: '选项四', outcomes: [{ text: '平淡的一天。' }] },
        { label: '选项五', outcomes: [{ text: '平淡的一天。' }] },
      ],
    };
    const ev = validateEventProposal(s, evil)!;
    expect(ev).not.toBeNull();
    expect(ev.choices.length).toBeLessThanOrEqual(4);
    const ch = ev.choices[0];
    expect(ch.outcomes.length).toBeLessThanOrEqual(3);
    expect(ch.cost).toBeLessThanOrEqual(3000);
    expect(ch.check?.target).toBeLessThanOrEqual(90);
    expect(ch.outcomes[0].effects.attrs?.intelligence).toBeLessThanOrEqual(EVENT_LIMITS.attr);
    expect(ch.outcomes[0].effects.money).toBeLessThanOrEqual(EVENT_LIMITS.moneyGainMax);
    expect(ch.outcomes[0].effects.flags).toBeUndefined();
  });

  it('未结识的 npcId 会被丢弃', () => {
    const unmet = s.npcs.find((n) => !n.met);
    const ev = validateEventProposal(s, { ...valid, npcId: unmet?.id ?? 'nobody' });
    expect(ev?.npcId).toBeUndefined();
  });
});
