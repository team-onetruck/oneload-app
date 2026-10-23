/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: Playwright E2E 설정. 개발 서버를 서버 없는 mock 모드로 띄우고 휴대폰 화면 크기로 e2e/ 테스트를 돌린다
 */
import { defineConfig, devices } from '@playwright/test'

// 평소 쓰는 5173과 겹치지 않는 포트. 다른 설정으로 떠 있는 개발 서버를 재사용하지 않게 한다.
const PORT = 4179

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // 앱은 휴대폰 화면용이라 모바일 크롬 크기로 본다.
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // VITE_API_MODE=mock이면 백엔드 없이 데모 경로로 동작한다 (작업 2의 src/api/mode.ts). 이 값을 읽지 않는 코드에서는 영향이 없다.
    env: { VITE_API_MODE: 'mock' },
  },
})
