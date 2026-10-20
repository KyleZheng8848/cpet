import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Vite 会给 script/link 打上 crossorigin；在 Electron 生产环境走 file:// 时，
 * 带 CORS 模式的模块请求会静默失败，对话窗只剩 backgroundColor 一片空白。
 * 开发态走 http://localhost，所以本机 npm run dev 看不出来。
 */
function stripCrossOriginForFileProtocol(): Plugin {
  return {
    name: 'cpet-strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/gi, '')
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['koffi']
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/renderer/pet.html'),
          chat: resolve(__dirname, 'src/renderer/chat.html'),
          skins: resolve(__dirname, 'src/renderer/skins.html')
        }
      }
    },
    plugins: [react(), stripCrossOriginForFileProtocol()]
  }
})
