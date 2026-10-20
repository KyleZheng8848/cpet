import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // 渲染层的纯函数也要能进 node 测试，别为了跑测试改成相对路径 import
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    // 只测纯逻辑：不起 Electron、不碰真 CLI，保证一秒内跑完，能进 pre-commit / CI
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default'
  }
})
