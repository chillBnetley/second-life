// 生产环境静态服务器：托管 dist/，并把 /api/* 反向代理到 AI 代理（默认 8787）。
// 单容器部署：node server/proxy.mjs & node server/prod.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PROD_PORT || 8080);
const API_TARGET = process.env.API_TARGET || 'http://localhost:8787';
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // API 反向代理（AI 代理跑在同一容器的 8787）
  if (url.pathname.startsWith('/api/')) {
    try {
      const upstream = await fetch(API_TARGET + url.pathname + url.search, {
        method: req.method,
        headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise<string>((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); }),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8' });
      return res.end(text);
    } catch {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'AI 代理不可用' }));
    }
  }

  // 静态文件（hash 路由，全部回落到 index.html）
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file);
  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) return sendFile(res, index);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('请先运行 npm run build 生成 dist/');
}).listen(PORT, () => console.log(`[prod] 静态站点 http://localhost:${PORT}  (dist=${DIST}, api→${API_TARGET})`));
