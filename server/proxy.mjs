// AI 服务端代理：浏览器 → 本服务 → DeepSeek。API Key 只在这里读取，永远不会进入前端包。
// 运行：npm run server    （开发时 Vite 会把 /api 转发到这里）
//
// 安全要点（第二阶段加固）：
//  1. Origin 白名单：只允许配置过的站点调用，防止别人的网页盗刷你的额度；
//  2. 每 IP 每分钟限流 + 每日全局预算（次数与估算 token），超限直接 503/429，前端自动回落本地剧情；
//  3. 只转发 messages 与 temperature，客户端无法改模型、max_tokens 或 response_format；
//  4. 非 200 一律返回统一 {error}，不透传上游错误体（可能包含账号信息）；
//  5. 日志只记录状态码与耗时，**不记录**用户内容与密钥。
import http from 'node:http';
import fs from 'node:fs';

// 极简 .env 读取（无需额外依赖）
try {
  for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* 没有 .env 也可以，使用系统环境变量 */ }

const PORT = Number(process.env.PORT || 8787);

// ===================== 运行时可配置项（网页里填写，不用改 .env） =====================
// 保存到项目根目录的 .ai-config.json（已 gitignore，权限尽量设为仅本人可读）。
// 优先级：网页保存的配置 > .env > 系统环境变量；key 永远不会回传给浏览器。
const CONFIG_FILE = new URL('../.ai-config.json', import.meta.url);
const ENV_KEY = process.env.DEEPSEEK_API_KEY || '';
const ENV_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const runtime = { apiKey: '', model: '' };

function loadRuntimeConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (raw && typeof raw.apiKey === 'string') runtime.apiKey = raw.apiKey.trim();
    if (raw && typeof raw.model === 'string') runtime.model = raw.model.trim();
    if (runtime.apiKey) console.log(`[ai-proxy] 已载入网页保存的配置（模型 ${modelId()}）`);
  } catch { /* 没有配置文件是正常情况 */ }
}
function persistRuntimeConfig() {
  try {
    if (!runtime.apiKey) { try { fs.unlinkSync(CONFIG_FILE); } catch { /* 文件不存在 */ } return; }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey: runtime.apiKey, model: runtime.model || ENV_MODEL }, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error(`[ai-proxy] 保存配置失败：${e.message}`);
  }
}
const apiKey = () => runtime.apiKey || ENV_KEY;
const modelId = () => runtime.model || ENV_MODEL;
const configSource = () => (runtime.apiKey ? 'runtime' : ENV_KEY ? 'env' : 'none');
/** 只回显掩码，方便用户确认「现在用的是哪把 key」，绝不回传完整 key */
const keyHint = () => {
  const k = apiKey();
  return k ? `${k.slice(0, 5)}***${k.slice(-4)}` : '';
};

const MAX_BODY = 64 * 1024;
const MAX_MESSAGES = 6;
const MAX_CONTENT = 8000;
const MAX_TOKENS = 900;
const PER_IP_PER_MIN = 30;
const DAILY_CALL_BUDGET = Number(process.env.DAILY_CALL_BUDGET || 500);
const DAILY_TOKEN_BUDGET = Number(process.env.DAILY_TOKEN_BUDGET || 300_000);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 30_000);
const ALLOW_ORIGIN_EXTRA = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = [...DEFAULT_ORIGINS, ...ALLOW_ORIGIN_EXTRA];
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

const hits = new Map(); // 每 IP 每分钟滑动窗口
let budget = { date: todayKey(), calls: 0, tokens: 0 };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function resetBudgetIfNeeded() {
  const key = todayKey();
  if (budget.date !== key) budget = { date: key, calls: 0, tokens: 0 };
}
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS;
  if (origin && allowed.includes(origin)) {
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' };
  }
  return {};
}
function send(res, code, obj, origin) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) });
  res.end(JSON.stringify(obj));
}
const logLine = (status, ms) => console.log(`[ai-proxy] ${new Date().toISOString()} status=${status} ${ms}ms calls=${budget.calls} tokens=${budget.tokens}`);

/** 同源放行：前端与代理同域部署时浏览器仍会带 Origin，不能只认 localhost 白名单 */
function originAllowed(origin, host) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

/** 读取请求体，超过上限返回 null */
async function readBody(req, limit) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) return null;
  }
  return body;
}

loadRuntimeConfig();

http.createServer(async (req, res) => {
  const started = Date.now();
  const origin = req.headers.origin;
  const allowed = ALLOWED_ORIGINS;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }
  if (req.url === '/api/health' && req.method === 'GET') {
    resetBudgetIfNeeded();
    return send(res, 200, {
      ok: true, model: modelId(), keyConfigured: !!apiKey(),
      budget: { callsLeft: Math.max(0, DAILY_CALL_BUDGET - budget.calls), tokensLeft: Math.max(0, DAILY_TOKEN_BUDGET - budget.tokens) },
    }, origin);
  }

  // ---- 网页内 AI 配置：查询 / 保存 / 清除（key 只写进本机文件，不回传给浏览器）----
  if (req.url === '/api/ai/config' && req.method === 'GET') {
    resetBudgetIfNeeded();
    return send(res, 200, {
      ok: true,
      configured: !!apiKey(),
      model: modelId(),
      source: configSource(),
      keyHint: keyHint(),
      budget: { callsLeft: Math.max(0, DAILY_CALL_BUDGET - budget.calls), tokensLeft: Math.max(0, DAILY_TOKEN_BUDGET - budget.tokens) },
    }, origin);
  }
  if (req.url === '/api/ai/config' && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!originAllowed(origin, req.headers.host)) return send(res, 403, { error: 'origin not allowed' }, origin);
    if (req.method === 'DELETE') {
      runtime.apiKey = '';
      runtime.model = '';
      persistRuntimeConfig();
      console.log('[ai-proxy] 网页配置已清除');
      return send(res, 200, { ok: true, configured: !!apiKey(), model: modelId(), source: configSource(), keyHint: keyHint() }, origin);
    }
    const body = await readBody(req, 8 * 1024);
    if (body === null) return send(res, 413, { error: '配置内容过大' }, origin);
    let input;
    try { input = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }, origin); }
    const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    if (!key || key.length < 20 || key.length > 200 || /\s/.test(key)) {
      return send(res, 400, { error: 'API Key 格式看起来不对：应为一长串字符（以 sk- 开头），且不含空格' }, origin);
    }
    if (model && !/^[a-zA-Z0-9._:-]{3,60}$/.test(model)) {
      return send(res, 400, { error: '模型名格式不正确（例如 deepseek-chat）' }, origin);
    }
    runtime.apiKey = key;
    runtime.model = model || ENV_MODEL;
    persistRuntimeConfig();
    console.log(`[ai-proxy] 网页配置已更新（模型 ${runtime.model}）`);
    return send(res, 200, { ok: true, configured: true, model: modelId(), source: 'runtime', keyHint: keyHint() }, origin);
  }

  if (req.method !== 'POST' || req.url !== '/api/ai/chat') return send(res, 404, { error: 'not found' }, origin);
  // Origin 白名单：有 Origin 头时必须命中（没有 Origin 的调用来自 curl/同域服务端，放行）
  if (!originAllowed(origin, req.headers.host)) return send(res, 403, { error: 'origin not allowed' }, origin);
  if (!apiKey()) return send(res, 503, { error: 'AI 未配置：请在网页「AI 设置」里填入 API Key，或配置 .env' }, origin);
  resetBudgetIfNeeded();
  if (budget.calls >= DAILY_CALL_BUDGET || budget.tokens >= DAILY_TOKEN_BUDGET) {
    logLine(503, Date.now() - started);
    return send(res, 503, { error: 'AI 今日额度已用完，已回落本地剧情' }, origin);
  }

  const ip = req.socket.remoteAddress || 'x';
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (rec.length >= PER_IP_PER_MIN) {
    logLine(429, Date.now() - started);
    return send(res, 429, { error: '请求过于频繁' }, origin);
  }
  rec.push(now); hits.set(ip, rec);

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) return send(res, 413, { error: 'too large' }, origin);
  }
  let input;
  try { input = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }, origin); }
  // 白名单：只转发 messages 和 temperature，客户端无法改模型 / 参数
  const messages = Array.isArray(input.messages) ? input.messages.slice(0, MAX_MESSAGES).map((m) => ({
    role: m.role === 'system' ? 'system' : 'user', content: String(m.content ?? '').slice(0, MAX_CONTENT),
  })) : null;
  if (!messages?.length) return send(res, 400, { error: 'messages required' }, origin);

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      body: JSON.stringify({
        model: modelId(), messages, stream: false, max_tokens: MAX_TOKENS,
        temperature: Math.min(1.3, Math.max(0, Number(input.temperature) || 0.8)),
        response_format: { type: 'json_object' },
      }),
    });
    const text = await r.text();
    budget.calls += 1;
    // 只统计用量，不透传上游错误体
    try {
      const usage = JSON.parse(text).usage;
      if (usage && Number.isFinite(usage.total_tokens)) budget.tokens += usage.total_tokens;
    } catch { /* 忽略解析失败 */ }
    logLine(r.status, Date.now() - started);
    if (!r.ok) return send(res, 502, { error: '上游模型暂时不可用' }, origin);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) });
    res.end(text);
  } catch (e) {
    logLine(504, Date.now() - started);
    send(res, 504, { error: e?.name === 'TimeoutError' ? '上游超时' : '上游连接失败' }, origin);
  }
}).listen(PORT, () => console.log(`AI proxy listening on http://localhost:${PORT}  (key ${apiKey() ? '已配置' : '未配置'}, 模型 ${modelId()}, 每日预算 ${DAILY_CALL_BUDGET} 次)`));

const shutdown = () => { console.log('[ai-proxy] 关闭中…'); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);