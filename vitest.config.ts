/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: vite 설정을 이어받아 vitest에 MSW 준비 파일을 연결하고 Playwright 테스트(e2e/)를 제외한다
 */
import type { UserConfigExport } from 'vite'
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// vite.config.ts가 객체든 ({ mode }) => 객체인 함수든 그대로 이어받는다.
export default defineConfig(async (env) => {
  const base = viteConfig as UserConfigExport
  return mergeConfig(await (typeof base === 'function' ? base(env) : base), {
    test: {
      setupFiles: ['src/test/setup.ts'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  })
})
