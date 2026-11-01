// Vercel Serverless Function：/api/ai/chat
// 与 server/proxy.mjs 同一套规则，但适配无状态函数运行环境。
// 环境变量：DEEPSEEK_API_KEY（必填）、DEEPSEEK_MODEL、ALLOWED_ORIGIN（可选，逗号分隔）。
const ALLOWED = ['http://localhost:5173', 'http://127.0.0.1:5173', ...(process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)];
const hits = new Map();
let budget = { date: '', calls: 0, tokens: 0 };
const DAILY_CALLS = Number(process.env.DAILY_CALL_BUDGET || 500);
const DAILY_TOKENS = Number(process.env.DAILY_TOKEN_BUDGET || 300000);

const cors = (origin) => (origin && ALLOWED.includes(origin)
  ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
  : {});

/** 同源请求放行（前端与函数同域部署时，浏览器仍会带 Origin） */
function originAllowed(origin, host) {
  if (!origin) return true; // curl / 服务端调用
  if (ALLOWED.includes(origin)) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(origin)); return res.end(); }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) });
    return res.end(JSON.stringify({ ok: true, keyConfigured: !!process.env.DEEPSEEK_API_KEY }));
  }
  if (req.method !== 'POST') { res.writeHead(405, cors(origin)); return res.end('{}'); }
  if (!originAllowed(origin, req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'application/json', ...cors(origin) });
    return res.end(JSON.stringify({ error: 'origin not allowed' }));
  }
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    res.writeHead(503, { 'Content-Type': 'application/json', ...cors(origin) });
    return res.end(JSON.stringify({ error: 'AI 未配置：请在平台环境变量里设置 DEEPSEEK_API_KEY' }));
  }

  // 单实例内限流与每日预算（无状态环境下的近似值；多实例时按实例计）
  const day = new Date().toISOString().slice(0, 10);
  if (budget.date !== day) budget = { date: day, calls: 0, tokens: 0 };
  const ip = (req.headers['x-forwarded-for'] || 'x').split(',')[0];
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (rec.length >= 30 || budget.calls >= DAILY_CALLS || budget.tokens >= DAILY_TOKENS) {
    res.writeHead(429, { 'Content-Type': 'application/json', ...cors(origin) });
    return res.end(JSON.stringify({ error: 'AI 今日额度或频率已达上限' }));
  }
  rec.push(now); hits.set(ip, rec);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const messages = Array.isArray(body?.messages)
    ? body.messages.slice(0, 6).map((m) => ({ role: m.role === 'system' ? 'system' : 'user', content: String(m.content ?? '').slice(0, 8000) }))
    : null;
  if (!messages?.length) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...cors(origin) });
    return res.end(JSON.stringify({ error: 'messages required' }));
  }

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages, stream: false, max_tokens: 900,
        temperature: Math.min(1.3, Math.max(0, Number(body.temperature) || 0.8)),
        response_format: { type: 'json_object' },
      }),
    });
    const text = await r.text();
    budget.calls += 1;
    try { const u = JSON.parse(text).usage; if (u && Number.isFinite(u.total_tokens)) budget.tokens += u.total_tokens; } catch { /* 忽略 */ }
    if (!r.ok) { res.writeHead(502, { 'Content-Type': 'application/json', ...cors(origin) }); return res.end(JSON.stringify({ error: '上游模型暂时不可用' })); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) });
    res.end(text);
  } catch {
    res.writeHead(504, { 'Content-Type': 'application/json', ...cors(origin) });
    res.end(JSON.stringify({ error: '上游超时或连接失败' }));
  }
}
