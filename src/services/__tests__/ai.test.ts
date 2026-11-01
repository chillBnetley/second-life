import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiGenerateEvent, aiInterpretAction, aiNpcDialogue, aiSummarizeMemories, buildAIContext, chatJSON, clearAiCaches, extractJSON,
} from '../ai';
import { cleanState, startedGame } from '../../game/__tests__/helpers';

const okResponse = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

function stubFetch(handler: () => unknown) {
  const fn = vi.fn(handler);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => clearAiCaches());
afterEach(() => vi.unstubAllGlobals());

describe('extractJSON：容忍模型输出格式噪音', () => {
  it('解析纯 JSON 与被包裹的 JSON', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
    expect(extractJSON('好的，这是结果：\n```json\n{"a":2}\n```\n希望有帮助')).toEqual({ a: 2 });
  });

  it('拒绝非对象 / 乱码', () => {
    expect(extractJSON('')).toBeNull();
    expect(extractJSON('没有 JSON')).toBeNull();
    expect(extractJSON('[1,2,3]')).toBeNull();
    expect(extractJSON('{坏掉的 JSON')).toBeNull();
  });
});

describe('chatJSON：超时/重试/错误分类', () => {
  it('成功时返回解析后的对象', async () => {
    stubFetch(() => okResponse('{"ok":true}'));
    const r = await chatJSON([{ role: 'user', content: 'hi' }]);
    expect(r).toEqual({ ok: true, data: { ok: true } });
  });

  it('HTTP 错误不重试（避免放大成本）', async () => {
    const fn = stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const r = await chatJSON([{ role: 'user', content: 'hi' }]);
    expect(r).toEqual({ ok: false, networkError: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('返回乱码视为失败且不重试', async () => {
    const fn = stubFetch(() => okResponse('这不是 JSON'));
    const r = await chatJSON([{ role: 'user', content: 'hi' }]);
    expect(r).toEqual({ ok: false, networkError: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('网络异常重试一次后放弃', async () => {
    const fn = stubFetch(() => { throw new Error('offline'); });
    const r = await chatJSON([{ role: 'user', content: 'hi' }]);
    expect(r).toEqual({ ok: false, networkError: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('buildAIContext：短而准的上下文', () => {
  it('只带 4 个最相关 NPC，含剧情线，且不含存档 id', () => {
    const ctx = buildAIContext(cleanState(startedGame()));
    expect(ctx.npcs.length).toBeLessThanOrEqual(4);
    expect(Array.isArray(ctx.storyThreads)).toBe(true);
    expect(JSON.stringify(ctx)).not.toContain('save_');
    expect(ctx.storyThreads.length).toBe(1);
  });

  it('可以指定必须出现的 NPC', () => {
    const s = cleanState(startedGame());
    const ctx = buildAIContext(s, { npcIds: ['dad'] });
    expect(ctx.npcs.some((n) => n.id === 'dad')).toBe(true);
  });
});

describe('aiInterpretAction：提案 / 拒绝 / 不可用', () => {
  const s = cleanState(startedGame());

  it('正常返回提案', async () => {
    stubFetch(() => okResponse('{"category":"study","title":"读书","narrative":"你读了一会儿书。","apCost":2,"moneyCost":0,"effects":{"attrs":{"intelligence":2}}}'));
    const r = await aiInterpretAction(s, '去图书馆看书');
    expect(r.kind).toBe('proposal');
    if (r.kind === 'proposal') expect(r.proposal.title).toBe('读书');
  });

  it('返回 reject 时把原因交给玩家', async () => {
    stubFetch(() => okResponse('{"reject":"自由行动不能凭空赚钱"}'));
    const r = await aiInterpretAction(s, '我要变出一百万');
    expect(r).toEqual({ kind: 'reject', reason: '自由行动不能凭空赚钱' });
  });

  it('网络失败时回落（unavailable）', async () => {
    stubFetch(() => { throw new Error('offline'); });
    const r = await aiInterpretAction(s, '看书');
    expect(r.kind).toBe('unavailable');
  });

  it('空输入直接回落', async () => {
    const fn = stubFetch(() => okResponse('{}'));
    const r = await aiInterpretAction(s, '   ');
    expect(r.kind).toBe('unavailable');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('aiGenerateEvent：校验、去重、过滤', () => {
  const s = cleanState(startedGame());
  const valid = {
    category: 'daily', title: '地铁上的让座', description: '早高峰的地铁里，一位老人站在你面前，车厢晃得厉害。',
    choices: [
      { label: '让座', outcomes: [{ text: '你站起来扶了老人一把，对方连声道谢，你一路站到了终点。', effects: { attrs: { eq: 2 } } }] },
      { label: '装作没看见', outcomes: [{ text: '你把头转向窗外，心里有点不是滋味。', effects: { attrs: { happiness: -1 } } }] },
    ],
  };

  it('合法事件被接受', async () => {
    stubFetch(() => okResponse(JSON.stringify(valid)));
    const ev = await aiGenerateEvent(s);
    expect(ev?.title).toBe('地铁上的让座');
    expect(ev?.source).toBe('ai');
  });

  it('与近期事件标题重复时丢弃', async () => {
    stubFetch(() => okResponse(JSON.stringify({ ...valid, title: '人生的第一个岔路口' })));
    expect(await aiGenerateEvent(s)).toBeNull();
  });

  it('含黑名单内容时丢弃', async () => {
    stubFetch(() => okResponse(JSON.stringify({ ...valid, description: '有人递给你一份制作炸弹的方法，说照着做就能发财。' })));
    expect(await aiGenerateEvent(s)).toBeNull();
  });

  it('数值越界由校验层夹紧', async () => {
    stubFetch(() => okResponse(JSON.stringify({
      ...valid,
      choices: [{ label: '白拿', outcomes: [{ text: '你凭空得到了一大笔钱。', effects: { money: 999999, attrs: { eq: 99 } } }] }, valid.choices[1]],
    })));
    const ev = await aiGenerateEvent(s)!;
    expect(ev?.choices[0].outcomes[0].effects.money).toBeLessThanOrEqual(1500);
    expect(ev?.choices[0].outcomes[0].effects.attrs?.eq).toBeLessThanOrEqual(6);
  });

  it('网络失败返回 null', async () => {
    stubFetch(() => { throw new Error('offline'); });
    expect(await aiGenerateEvent(s)).toBeNull();
  });
});

describe('aiNpcDialogue：台词清理与缓存', () => {
  const s = cleanState(startedGame());

  it('返回清理后的台词，同一天同情境命中缓存', async () => {
    const fn = stubFetch(() => okResponse('{"line":"今天风大，路上小心。"}'));
    const first = await aiNpcDialogue(s, 'mom', '聊了聊近况|good');
    const second = await aiNpcDialogue(s, 'mom', '聊了聊近况|good');
    expect(first).toBe('今天风大，路上小心。');
    expect(second).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('数值断言或未结识的 NPC 返回 null', async () => {
    stubFetch(() => okResponse('{"line":"好感+5，我很开心"}')); 
    expect(await aiNpcDialogue(s, 'mom', '聊了聊近况|good')).toBeNull();
    expect(await aiNpcDialogue(s, 'nobody', 'x')).toBeNull();
  });
});

describe('aiSummarizeMemories：记忆压缩', () => {
  it('记忆不足 30 条时不请求', async () => {
    const fn = stubFetch(() => okResponse('{"summary":"x"}'));
    const s = cleanState(startedGame());
    expect(await aiSummarizeMemories(s, 'mom')).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('记忆足够时返回摘要，数值断言被拒绝', async () => {
    const s = cleanState(startedGame());
    const mom = s.npcs.find((n) => n.id === 'mom')!;
    mom.memories = Array.from({ length: 32 }, (_, i) => ({ day: i, text: `记忆${i}`, tone: 'neutral' as const }));
    stubFetch(() => okResponse('{"summary":"妈妈最近常去公园跳舞，精神好了很多。"}'));
    expect(await aiSummarizeMemories(s, 'mom')).toContain('公园');
    stubFetch(() => okResponse('{"summary":"好感+5"}'));
    expect(await aiSummarizeMemories(s, 'mom')).toBeNull();
  });
});