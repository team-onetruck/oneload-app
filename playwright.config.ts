/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: Playwright E2E 설정. 스모크는 서버 없는 mock 모드, 시나리오는 http 모드(/api/v1을 MSW 핸들러가 답함)로 휴대폰 화면 크기에서 돌린다
 */
import { defineConfig, devices } from '@playwright/test'

// 평소 쓰는 5173과 겹치지 않는 포트. 다른 설정으로 떠 있는 개발 서버를 재사용하지 않게 한다.
const MOCK_PORT = 4179
const HTTP_PORT = 4180

// VITE_API_MODE는 빌드 때 정해지므로 모드마다 개발 서버를 따로 띄운다 (src/api/mode.ts).
const devServer = (port: number, mode: 'mock' | 'http') => ({
  command: `pnpm exec vite --port ${port} --strictPort`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  env: { VITE_API_MODE: mode },
})

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  // 앱은 휴대폰 화면용이라 모바일 크롬 크기로 본다.
  projects: [
    // 서버 없는 데모 경로가 뜨는지만 본다
    { name: 'mock', testMatch: 'smoke.spec.ts', use: { ...devices['Pixel 7'], baseURL: `http://localhost:${MOCK_PORT}` } },
    // 서버 연동 경로. /api/v1은 page.route로 가로채 MSW 핸들러가 답한다 (e2e/support/mockApi.ts). 실제 백엔드는 필요 없다
    { name: 'http', testMatch: 'scenarios/*.spec.ts', use: { ...devices['Pixel 7'], baseURL: `http://localhost:${HTTP_PORT}` } },
  ],
  webServer: [devServer(MOCK_PORT, 'mock'), devServer(HTTP_PORT, 'http')],
})
