/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 로컬 실제 API·DB와 프론트를 연결해 주요 흐름을 확인하고 화면과 비밀값 없는 요청 기록을 저장한다
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'

const baseURL = process.env.LOCAL_APP_URL || 'http://127.0.0.1:5173'
const output = resolve('docs/verification/2026-10-24-local')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({
  baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  isMobile: true, hasTouch: true, locale: 'ko-KR',
})
const page = await context.newPage()
const calls = []
const pending = []
const pageErrors = []
const capture = (name) => page.screenshot({ path: resolve(output, name), fullPage: true, animations: 'disabled' })
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('response', (response) => {
  const url = new URL(response.url())
  if (!url.pathname.startsWith('/api/v1/')) return
  const entry = {
    method: response.request().method(),
    path: url.pathname.replace(/\/sessions\/[^/]+/, '/sessions/{id}'),
    status: response.status(),
  }
  calls.push(entry)
  pending.push(response.json().then((body) => {
    if (body.error) entry.errorCode = body.error.code
    if (body.session) entry.session = body.session
    if (body.destination) entry.destination = body.destination
    if (body.steps) entry.routeStepCount = body.steps.length
    if (body.dependencies) entry.dependencies = body.dependencies
  }).catch(() => {}))
})

try {
  const healthResponse = await context.request.get('/api/v1/health')
  expect(healthResponse.status()).toBe(200)
  const health = await healthResponse.json()
  expect(health.dependencies.database).toBe('ok')

  await page.goto('/?demo')
  await expect(page.getByRole('heading', { name: '한길 Hangil' })).toBeVisible()
  await expect(page.getByText(/Demo|Live|데모|라이브|실서버/)).toHaveCount(0)
  await capture('01-start.png')

  await page.getByRole('button', { name: '시작하기', exact: true }).click()
  await page.getByRole('button', { name: '인천공항', exact: true }).click()
  await page.getByRole('button', { name: '직통열차', exact: true }).click()
  await expect(page.getByRole('button', { name: '현재 위치 찾기', exact: true })).toBeVisible()
  await capture('02-chat.png')

  await page.getByRole('button', { name: '현재 위치 찾기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '주변 안내판을 찍어주세요' })).toBeVisible()
  await expect(page.getByText(/데모 사진/)).toHaveCount(0)
  await capture('03-upload.png')

  // 저장소의 예시 사진을 실제 업로드한다. API 응답을 가로채거나 대체하지 않는다.
  await page.locator('input[type=file]').setInputFiles(resolve('public/panos/subway_entrance.webp'))
  await expect(page.getByRole('heading', { name: '지금 어디에 있나요?' })).toBeVisible()
  await expect(page.getByText('지금은 사진으로 위치를 찾을 수 없어요. 목록에서 골라 주세요.')).toBeVisible()
  await capture('04-photo-fallback.png')

  await page.getByRole('button', { name: /KTX 맞이방/ }).click()
  await expect(page.getByRole('heading', { name: '직통열차 표 사는 곳' })).toBeVisible()
  await expect.poll(() => calls.some((call) => call.path.endsWith('/navigation-events') && call.status === 200)).toBe(true)
  await capture('05-route.png')

  await page.getByRole('tab', { name: '카메라', exact: true }).click()
  await expect(page.getByRole('button', { name: '카메라 켜기' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Live|라이브/ })).toHaveCount(0)
  await capture('06-camera.png')

  await page.getByRole('tab', { name: '노선', exact: true }).click()
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await page.getByRole('button', { name: '도착했어요', exact: true }).click()
  await expect(page.getByRole('heading', { name: '도착했어요' })).toBeVisible()
  await expect.poll(() => calls.filter((call) => call.path.endsWith('/navigation-events') && call.status === 200).length).toBe(2)
  await capture('07-arrived.png')
  await Promise.all(pending)
  expect(pageErrors).toEqual([])
  expect(calls.filter((call) => call.status >= 400)).toEqual([
    expect.objectContaining({ path: expect.stringContaining('/localizations'), status: 503, errorCode: 'AI_SERVICE_UNAVAILABLE' }),
  ])
  await writeFile(resolve(output, 'api-summary.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), baseURL, health,
    apiResponsesReplaced: false, aiMode: 'RuleAgent / NoVision (OPENAI_API_KEY 없음)',
    calls, pageErrors,
  }, null, 2) + '\n')
  console.log(`로컬 실제 연동 확인 완료: ${output}`)
} catch (error) {
  await capture('failure.png').catch(() => {})
  throw error
} finally {
  await browser.close()
}
