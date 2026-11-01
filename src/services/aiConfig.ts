/**
 * 网页内 AI 配置（第三阶段追加）。
 *
 * 设计原则：
 *  - API Key **只发给本机代理**（`/api/ai/config`），由代理保存到 `.ai-config.json`，从不进入前端包、存档或 localStorage；
 *  - 代理只回显掩码（如 `sk-ab***wxyz`），完整 key 永远不会回传到浏览器；
 *  - 所有请求失败都必须可解释：代理没启动 / 未配置 / 格式错误 / 上游不可用，分别给出不同提示。
 */

export const AI_CONFIG_ENDPOINT = '/api/ai/config';

export interface AiConfigStatus {
  /** 本机代理是否可达（npm run server 是否在跑） */
  reachable: boolean;
  configured: boolean;
  model: string;
  /** runtime = 网页里保存的；env = 来自 .env；none = 还没配置 */
  source: 'runtime' | 'env' | 'none';
  /** 掩码后的 key，用于确认当前用的是哪一把 */
  keyHint: string;
  callsLeft?: number;
  tokensLeft?: number;
}

const unreachable = (): AiConfigStatus => ({ reachable: false, configured: false, model: '', source: 'none', keyHint: '' });

const asStatus = (raw: unknown): AiConfigStatus | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const source = o.source === 'runtime' || o.source === 'env' ? o.source : 'none';
  const budget = (o.budget ?? {}) as Record<string, unknown>;
  return {
    reachable: true,
    configured: o.configured === true,
    model: typeof o.model === 'string' ? o.model : '',
    source,
    keyHint: typeof o.keyHint === 'string' ? o.keyHint : '',
    callsLeft: typeof budget.callsLeft === 'number' ? budget.callsLeft : undefined,
    tokensLeft: typeof budget.tokensLeft === 'number' ? budget.tokensLeft : undefined,
  };
};

/** 读取当前配置状态；代理不可达时 reachable=false，不抛错 */
export async function getAiConfig(): Promise<AiConfigStatus> {
  try {
    const res = await fetch(AI_CONFIG_ENDPOINT, { method: 'GET' });
    if (!res.ok) return unreachable();
    return asStatus(await res.json()) ?? unreachable();
  } catch {
    return unreachable();
  }
}

export interface SaveResult { ok: boolean; error?: string; status?: AiConfigStatus }

/** 保存 key（和可选模型名）到本机代理 */
export async function saveAiConfig(apiKey: string, model: string): Promise<SaveResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: '请先填入 API Key。' };
  try {
    const res = await fetch(AI_CONFIG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, model: model.trim() }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { ok: false, error: typeof data?.error === 'string' ? data.error : `保存失败（HTTP ${res.status}）` };
    return { ok: true, status: asStatus(data) ?? undefined };
  } catch {
    return { ok: false, error: '连不上本机 AI 代理：请先运行 npm run server。' };
  }
}

/** 清除网页保存的配置（.env 里的配置仍然有效） */
export async function clearAiConfig(): Promise<SaveResult> {
  try {
    const res = await fetch(AI_CONFIG_ENDPOINT, { method: 'DELETE' });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { ok: false, error: typeof data?.error === 'string' ? data.error : `清除失败（HTTP ${res.status}）` };
    return { ok: true, status: asStatus(data) ?? undefined };
  } catch {
    return { ok: false, error: '连不上本机 AI 代理：请先运行 npm run server。' };
  }
}

export interface TestResult { ok: boolean; message: string }

/**
 * 测试连接：走一次真实的最小请求（约几十 token）。
 * 与游戏内的 AI 调用同一条链路，能真正验证 key、网络与账号额度。
 */
export async function testAiConnection(): Promise<TestResult> {
  const started = Date.now();
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '你只输出一个 JSON 对象，不要输出多余文字。' },
          { role: 'user', content: '回复 {"ok":true} 这个 JSON' },
        ],
        temperature: 0,
      }),
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) {
      let err = `HTTP ${res.status}`;
      try { const j = JSON.parse(text) as { error?: string }; if (j.error) err = j.error; } catch { /* 忽略 */ }
      return { ok: false, message: `连接失败：${err}` };
    }
    let content = '';
    try {
      const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
      content = j.choices?.[0]?.message?.content ?? '';
      const tokens = j.usage?.total_tokens;
      return { ok: true, message: `连接正常（${ms}ms${tokens ? `，${tokens} tokens` : ''}）：${content.slice(0, 40)}` };
    } catch {
      return { ok: false, message: '连接成功但返回内容不是 JSON，请检查模型名是否正确。' };
    }
  } catch {
    return { ok: false, message: '连不上本机 AI 代理：请先运行 npm run server。' };
  }
}
