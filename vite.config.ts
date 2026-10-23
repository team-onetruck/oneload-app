import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      // 배포에서는 Caddy가 같은 origin의 /api/*를 백엔드로 넘긴다. 개발 서버도 같은 경로를 프록시해서 CORS 없이 붙는다.
      // 배포 서버에 붙이려면 VITE_API_PROXY_TARGET=https://baki-macbookpro.tail3286a4.ts.net:10000 pnpm dev
      proxy: {
        '/api': { target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
  }
})
