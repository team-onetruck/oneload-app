/**
 * Date: 2026-10-25
 * Author: Jung Minkyu
 * Purpose: 답사 화면의 iOS·Android 이벤트 수집, JSON 다운로드, 복구와 권한 거절을 브라우저에서 검증한다
 */
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
const schema = JSON.parse(readFileSync(new URL('../../src/features/survey/survey.schema.json', import.meta.url), 'utf8'))

const validator = new Ajv2020({ strict: false })
addFormats(validator)
const validate = validator.compile(schema)

async function fillForm(page: Page, browser: 'Safari' | 'Chrome') {
  for (const [label, value] of [
    ['답사 ID', 'SS-e2e'], ['담당자', '답사 시험'], ['기기 ID', `phone-${browser}`], ['기종', browser === 'Safari' ? '시험 iPhone' : '시험 Android'],
    ['OS 버전', '시험 OS'], ['브라우저', browser], ['브라우저 버전', '시험 버전'], ['지점 ID', 'node-A'], ['지점 이름', '기둥 앞'], ['층', 'B2'], ['서 있는 위치', '기둥 통로쪽 모서리'],
  ]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByLabel('기록 시간 (초)', { exact: true }).fill('1')
}

async function mockPermission(page: Page, permission: 'granted' | 'denied') {
  await page.addInitScript((value) => {
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true, value: () => Promise.resolve(value) })
  }, permission)
}

for (const browser of ['Safari', 'Chrome'] as const) {
  test(`답사 기록: ${browser} 원시 이벤트가 스키마 JSON으로 다운로드되고 새로고침 후 복구된다`, async ({ page }, testInfo) => {
    await mockPermission(page, 'granted')
    const apiCalls: string[] = []
    page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()) })
    await page.goto('/survey/sensors')
    await fillForm(page, browser)
    await page.getByRole('button', { name: '권한 요청하고 기록 시작' }).click()
    await expect(page.getByText('기록 중 ·', { exact: false })).toBeVisible()
    await page.evaluate((kind) => {
      const event = new DeviceOrientationEvent(kind === 'Safari' ? 'deviceorientation' : 'deviceorientationabsolute', { alpha: 270, beta: 90, gamma: 0, absolute: kind === 'Chrome' })
      if (kind === 'Safari') {
        Object.defineProperty(event, 'webkitCompassHeading', { value: 0 })
        Object.defineProperty(event, 'webkitCompassAccuracy', { value: -1 })
      }
      window.dispatchEvent(event)
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 15, beta: 88, gamma: 1, absolute: false }))
    }, browser)
    await expect(page.getByRole('button', { name: 'JSON 다운로드' })).toBeEnabled()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'JSON 다운로드' }).click()
    const download = await downloading
    const file = testInfo.outputPath(`sensor-survey-${browser}.json`)
    await download.saveAs(file)
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true)
    expect(manifest.data_kind).toBe('field')
    const trial = manifest.compass_trials[0]
    expect(trial).toMatchObject({ node_id: 'node-A', device_id: `phone-${browser}`, posture: 'rear_camera_forward_portrait', repeat_index: 1, result: 'readings' })
    expect(trial.samples.length).toBeGreaterThanOrEqual(2)
    // 실제 장치가 없는 Chromium이 먼저 보내는 null 이벤트도 원본으로 남으므로 주입한 이벤트를 찾는다.
    const first = trial.samples.find((sample: { alpha: number | null; webkit_compass_heading: number | null }) => browser === 'Safari' ? sample.webkit_compass_heading === 0 : sample.alpha === 270)
    expect(first).toBeTruthy()
    if (browser === 'Safari') {
      expect(first).toMatchObject({ event_type: 'deviceorientation', webkit_compass_heading: 0, webkit_compass_accuracy: -1, derived_rear_heading_deg: null })
      expect(trial.sensor_reference).toBe('magnetic_north')
    } else {
      expect(first).toMatchObject({ event_type: 'deviceorientationabsolute', alpha: 270, beta: 90, gamma: 0 })
      expect(first.derived_rear_heading_deg).toBeCloseTo(90)
    }
    expect(manifest.nodes[0].position_m).toBeNull()
    expect(manifest.ended_at).toBeTruthy()
    expect(apiCalls).toEqual([])
    await page.reload()
    await expect(page.getByRole('heading', { name: '저장된 시험 1회' })).toBeVisible()
    await expect(page.getByLabel('반복 회차', { exact: true })).toHaveValue('2')
    await expect(page.getByRole('button', { name: 'JSON 다운로드' })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath(`sensor-survey-${browser}.png`), fullPage: true })
  })
}

test('답사 기록: 권한 거절도 회차로 보존하고 다음 회차로 넘긴다', async ({ page }) => {
  await mockPermission(page, 'denied')
  await page.goto('/survey/sensors')
  await fillForm(page, 'Safari')
  await page.getByRole('button', { name: '권한 요청하고 기록 시작' }).click()
  await expect(page.getByText('후면 정면 · 0개 · 권한 거절')).toBeVisible()
  await expect(page.getByRole('button', { name: 'JSON 다운로드' })).toBeEnabled()
  await expect(page.getByLabel('반복 회차', { exact: true })).toHaveValue('2')
})

test('답사 기록: 화면 숨김으로 중단한 샘플이 남고 다음 회차를 기록할 수 있다', async ({ page }) => {
  await mockPermission(page, 'granted')
  await page.goto('/survey/sensors')
  await fillForm(page, 'Chrome')
  await page.getByLabel('기록 시간 (초)', { exact: true }).fill('10')
  await page.getByRole('button', { name: '권한 요청하고 기록 시작' }).click()
  await expect(page.getByLabel('지점 ID', { exact: true })).toBeDisabled()
  await page.evaluate(() => {
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 0, beta: 90, gamma: 0, absolute: true }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText(/후면 정면 · \d+개 · 중단·오류/)).toBeVisible()
  await expect(page.getByLabel('지점 ID', { exact: true })).toBeEnabled()
})
