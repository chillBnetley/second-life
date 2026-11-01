import { describe, expect, it } from 'vitest';
import {
  AI_COOLDOWN_MS, AI_DAILY_LIMIT, aiCallsToday, aiCooldownLeft, applyNpcSummary, canCallAi, closeStoryThread, injectEvent, interactWithNpc, recordAiCall, resolveEventChoice, rewriteNpcLine,
} from '../engine';
import type { GameEvent } from '../types';
import { cleanState, seededRng, startedGame } from './helpers';

const makeEvent = (day: number, costs: number[] = [0]): GameEvent => ({
  id: 'ev_test', defId: 'ai_test', category: 'daily', title: '窗外的雨',
  description: '傍晚忽然下起雨，你站在教学楼门口。', source: 'ai', day,
  choices: costs.map((cost, i) => ({ id: `c${i}`, label: `选项${i}`, ...(cost ? { cost } : {}), outcomes: [{ weight: 1, text: '雨停了。', effects: {} }] })),
});

describe('injectEvent：AI 事件注入的并发与兜底', () => {
  it('没有待处理事件时可以注入，并写入日志', () => {
    const s = cleanState(startedGame());
    const r = injectEvent(s, makeEvent(s.day));
    expect(r.result.ok).toBe(true);
    expect(r.state.pendingEvent?.defId).toBe('ai_test');
    expect(r.state.log[r.state.log.length - 1].title).toBe('窗外的雨');
  });

  it('已有事件时拒绝注入', () => {
    const s = cleanState(startedGame());
    const first = injectEvent(s, makeEvent(s.day));
    const second = injectEvent(first.state, makeEvent(s.day));
    expect(second.result.ok).toBe(false);
  });

  it('日期已经变化时丢弃（乐观并发）', () => {
    const s = cleanState(startedGame());
    expect(injectEvent(s, makeEvent(s.day), s.day + 3).result.ok).toBe(false);
    expect(injectEvent(s, makeEvent(s.day + 3)).result.ok).toBe(false);
  });

  it('所有选项都付不起时拒绝注入，避免卡死当天', () => {
    const s = cleanState(startedGame());
    s.player.money = 100;
    expect(injectEvent(s, makeEvent(s.day, [500, 900])).result.ok).toBe(false);
    expect(injectEvent(s, makeEvent(s.day, [500, 0])).result.ok).toBe(true);
  });
});

describe('rewriteNpcLine：只换文案不改数值', () => {
  function chatState() {
    const base = cleanState(startedGame());
    const r = interactWithNpc(base, 'mom', 'chat', seededRng(3));
    expect(r.result.ok).toBe(true);
    return r.state;
  }

  it('把模板台词替换成 AI 台词并写入记忆', () => {
    const s = chatState();
    const line = '妈在电话那头笑，说冰箱里给你留了饺子。';
    const beforeMoney = s.player.money;
    const beforeAttrs = { ...s.player.attrs };
    const r = rewriteNpcLine(s, 'mom', line);
    expect(r.result.ok).toBe(true);
    expect(r.state.log[r.state.log.length - 1].text).toContain(line);
    expect(r.state.player.money).toBe(beforeMoney);
    expect(r.state.player.attrs).toEqual(beforeAttrs);
    expect(r.state.npcs.find((n) => n.id === 'mom')!.memories.some((m) => m.text.includes('冰箱里'))).toBe(true);
  });

  it('拒绝数值断言、空台词与未知 NPC', () => {
    const s = chatState();
    expect(rewriteNpcLine(s, 'mom', '好感+5，她很开心').result.ok).toBe(false);
    expect(rewriteNpcLine(s, 'mom', '   ').result.ok).toBe(false);
    expect(rewriteNpcLine(s, 'nonexistent', '你好').result.ok).toBe(false);
  });

  it('超长台词被截断到 60 字以内', () => {
    const s = chatState();
    const long = '啊'.repeat(200);
    const r = rewriteNpcLine(s, 'mom', long);
    expect(r.result.ok).toBe(true);
    expect(r.result.text.length).toBeLessThanOrEqual(60);
  });
});

describe('AI 预算与熔断', () => {
  it('每日次数上限生效，跨天自动重置', () => {
    let s = cleanState(startedGame());
    expect(aiCallsToday(s)).toBe(0);
    for (let i = 0; i < AI_DAILY_LIMIT; i++) s = recordAiCall(s, true).state;
    expect(aiCallsToday(s)).toBe(AI_DAILY_LIMIT);
    expect(canCallAi(s)).toBe(false);
    const next = { ...s, day: s.day + 1 };
    expect(aiCallsToday(next)).toBe(0);
    expect(canCallAi(next)).toBe(true);
  });

  it('连续失败达到阈值触发熔断，熔断期内不可调用', () => {
    let s = cleanState(startedGame());
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) s = recordAiCall(s, false, now).state;
    expect(canCallAi(s, now)).toBe(false);
    expect(aiCooldownLeft(s, now)).toBe(AI_COOLDOWN_MS);
    expect(canCallAi(s, now + AI_COOLDOWN_MS + 1)).toBe(true);
  });

  it('成功一次会清空连续失败计数', () => {
    let s = cleanState(startedGame());
    s = recordAiCall(s, false).state;
    s = recordAiCall(s, false).state;
    s = recordAiCall(s, true).state;
    expect(s.ai.failures).toBe(0);
  });
});

describe('NPC 记忆摘要', () => {
  it('写入摘要并在记忆过多时压缩早期记忆', () => {
    const s = cleanState(startedGame());
    const mom = s.npcs.find((n) => n.id === 'mom')!;
    mom.memories = Array.from({ length: 35 }, (_, i) => ({ day: i, text: `旧记忆${i}`, tone: 'neutral' as const }));
    const r = applyNpcSummary(s, 'mom', '妈妈最近迷上了广场舞，每天都要去公园。');
    expect(r.result.ok).toBe(true);
    const after = r.state.npcs.find((n) => n.id === 'mom')!;
    expect(after.summary).toContain('广场舞');
    expect(after.memories.length).toBe(15);
  });

  it('拒绝数值描述与空摘要', () => {
    const s = cleanState(startedGame());
    expect(applyNpcSummary(s, 'mom', '好感 +5').result.ok).toBe(false);
    expect(applyNpcSummary(s, 'mom', '').result.ok).toBe(false);
  });
});

describe('剧情线 storyThreads', () => {
  it('重大事件的选择会被记录成剧情事实', () => {
    const s = startedGame();
    expect(s.storyThreads.length).toBe(1);
    const th = s.storyThreads[0];
    expect(th.title).toContain('岔路口');
    expect(th.summary).toContain('去上大学');
    expect(th.status).toBe('open');
  });

  it('可以关闭剧情线', () => {
    const s = startedGame();
    const id = s.storyThreads[0].id;
    const r = closeStoryThread(s, id);
    expect(r.result.ok).toBe(true);
    expect(r.state.storyThreads[0].status).toBe('closed');
    expect(closeStoryThread(s, 'nope').result.ok).toBe(false);
  });

  it('剧情线总条数不超过上限', () => {
    let s = startedGame();
    for (let i = 0; i < 10; i++) {
      const ev: GameEvent = {
        id: `e${i}`, defId: `ai_${i}`, category: 'major', title: `事件${i}`, description: '一段足够长的事件描述文本。',
        source: 'ai', day: s.day, choices: [{ id: 'c0', label: '面对', outcomes: [{ weight: 1, text: '结束了。', effects: {} }] }],
      };
      s = injectEvent(s, ev).state;
      const resolved = s.pendingEvent ? s.pendingEvent.choices[0].id : null;
      if (resolved) s = resolveEventChoice(s, resolved, seededRng(i + 1)).state;
    }
    expect(s.storyThreads.length).toBeLessThanOrEqual(6);
  });
});