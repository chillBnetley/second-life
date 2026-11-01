import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 规则引擎与校验层都是纯 TS，不需要浏览器环境；UI 冒烟测试将来单独加 environment: 'jsdom'。
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'default',
  },
});
