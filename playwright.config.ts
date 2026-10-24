/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 연결 앱을 휴대폰·데스크톱에서 검증한다. /api/v1 응답은 테스트 안에서 MSW 핸들러가 만든다
 */
import { defineConfig, devices } from '@playwright/test'

// 평소 쓰는 5173과 겹치지 않는 포트. 다른 설정으로 떠 있는 개발 서버를 재사용하지 않게 한다.
const HTTP_PORT = 4180

// 예전 환경변수가 남아 있어도 데모로 바뀌지 않는지 함께 검증한다.
const devServer = (port: number) => ({
  command: `pnpm exec vite --port ${port} --strictPort`,
  url: `http://localhost:${port}`,
  reuseExistingServer: false,
  env: { VITE_API_MODE: 'mock' },
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
    { name: 'http', testMatch: ['smoke.spec.ts', 'scenarios/*.spec.ts'], use: { ...devices['Pixel 7'], baseURL: `http://localhost:${HTTP_PORT}` } },
    { name: 'desktop', testMatch: 'scenarios/service-entry.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${HTTP_PORT}` } },
  ],
  webServer: devServer(HTTP_PORT),
})
