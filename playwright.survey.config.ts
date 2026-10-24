/**
 * Date: 2026-10-25
 * Author: Jung Minkyu
 * Purpose: 다른 세션의 개발 서버와 충돌하지 않는 포트로 센서 답사 화면을 검증한다
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e', testMatch: 'scenarios/sensor-survey.spec.ts', fullyParallel: true,
  use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4185', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --port 4185 --strictPort', url: 'http://localhost:4185', reuseExistingServer: false },
})
