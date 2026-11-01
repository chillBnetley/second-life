import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时把 /api 转发到本地 AI 代理（npm run server）。API Key 只存在于服务端环境变量。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
    // 忽略编辑器/工具产生的临时文件：否则监听锁冲突会让 dev server 直接崩溃（EBUSY）
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/.*.tmp', '**/*.tmp', '**/.ai-config.json', '**/.npm-cache/**'],
    },
  },
});
