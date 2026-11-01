import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAiConfig, getAiConfig, saveAiConfig, testAiConnection } from '../aiConfig';

const jsonRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

type Call = { url: string; init?: RequestInit };

function stub(handler: (url: string, init?: RequestInit) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('getAiConfig：读取代理状态', () => {
  it('解析已配置状态与预算', async () => {
    stub(() => jsonRes(200, {
      ok: true, configured: true, model: 'deepseek-chat', source: 'runtime', keyHint: 'sk-ab***wxyz',
      budget: { callsLeft: 12, tokensLeft: 999 },
    }));
    const s = await getAiConfig();
    expect(s).toMatchObject({ reachable: true, configured: true, model: 'deepseek-chat', source: 'runtime', keyHint: 'sk-ab***wxyz', callsLeft: 12 });
  });

  it('代理不可达时返回 reachable=false 而不是抛错', async () => {
    stub(() => { throw new Error('ECONNREFUSED'); });
    const s = await getAiConfig();
    expect(s.reachable).toBe(false);
    expect(s.configured).toBe(false);
  });

  it('代理返回非 200 也视作不可达', async () => {
    stub(() => jsonRes(404, { error: 'not found' }));
    expect((await getAiConfig()).reachable).toBe(false);
  });

  it('未知 source 归一化为 none', async () => {
    stub(() => jsonRes(200, { configured: false, model: 'x', source: 'weird' }));
    const s = await getAiConfig();
    expect(s.source).toBe('none');
    expect(s.configured).toBe(false);
  });
});

describe('saveAiConfig：保存到本机代理', () => {
  it('把 key 与模型 POST 给 /api/ai/config', async () => {
    const calls = stub(() => jsonRes(200, { ok: true, configured: true, model: 'deepseek-reasoner', source: 'runtime', keyHint: 'sk-12***6789' }));
    const r = await saveAiConfig('  sk-1234567890abcdef  ', 'deepseek-reasoner');
    expect(r.ok).toBe(true);
    expect(r.status?.model).toBe('deepseek-reasoner');
    expect(calls[0].url).toBe('/api/ai/config');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ apiKey: 'sk-1234567890abcdef', model: 'deepseek-reasoner' });
  });

  it('空白 key 直接拒绝，不发请求', async () => {
    const calls = stub(() => jsonRes(200, {}));
    const r = await saveAiConfig('   ', 'deepseek-chat');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('API Key');
    expect(calls).toHaveLength(0);
  });

  it('把代理返回的具体错误交给用户', async () => {
    stub(() => jsonRes(400, { error: 'API Key 格式看起来不对：应为一长串字符' }));
    const r = await saveAiConfig('bad', 'deepseek-chat');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('格式');
  });

  it('代理没启动时提示先运行 server', async () => {
    stub(() => { throw new Error('offline'); });
    const r = await saveAiConfig('sk-abcdefghijklmnopqrstuvwxyz', 'deepseek-chat');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('npm run server');
  });
});

describe('clearAiConfig：清除网页配置', () => {
  it('发送 DELETE 并回传新状态', async () => {
    const calls = stub(() => jsonRes(200, { ok: true, configured: false, model: 'deepseek-chat', source: 'none', keyHint: '' }));
    const r = await clearAiConfig();
    expect(r.ok).toBe(true);
    expect(r.status?.configured).toBe(false);
    expect(calls[0].init?.method).toBe('DELETE');
  });
});

describe('testAiConnection：真实链路测试', () => {
  it('成功时报告耗时与用量', async () => {
    stub(() => jsonRes(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { total_tokens: 53 } }));
    const r = await testAiConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toContain('连接正常');
    expect(r.message).toContain('53 tokens');
  });

  it('代理报错时透出错误原因', async () => {
    stub(() => jsonRes(503, { error: 'AI 未配置：请在网页「AI 设置」里填入 API Key' }));
    const r = await testAiConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('AI 未配置');
  });

  it('网络不通时提示启动代理', async () => {
    stub(() => { throw new Error('offline'); });
    const r = await testAiConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('npm run server');
  });

  it('返回非 JSON 内容时提示检查模型名', async () => {
    stub(() => ({ ok: true, status: 200, text: async () => 'not json', json: async () => { throw new Error('bad'); } }));
    const r = await testAiConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('模型名');
  });
});