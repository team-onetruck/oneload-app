/**
 * Date: 2026-10-26
 * Author: Jung Minkyu
 * Purpose: 거리뷰 진행 표시 E2E. 노선 보기처럼 정거장마다 원이 있고, 지나온 정거장은 채워지며, 지금 위치 링이 다음 정거장으로 옮겨 가는지 확인한다
 */
import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { interceptApi, signPhoto } from '../support/mockApi'

const centerX = async (el: Locator) => {
  const box = (await el.boundingBox())!
  return box.x + box.width / 2
}

test('거리뷰: 정거장 원과 지금 위치 링이 노선 보기처럼 단계를 따라간다', async ({ page }) => {
  await interceptApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'Express', exact: true }).click()
  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.locator('label', { hasText: 'Take a photo' }).locator('input[type=file]').setInputFiles(await signPhoto(page))
  const line4 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /Line 4 Seoul Station gates/ }) })
  await line4.getByRole('button', { name: 'I’m here' }).click()
  await expect(page.getByRole('heading', { name: 'Express ticket counter' })).toBeVisible()
  // 목적지 이름 위의 'To' 라벨은 두지 않는다
  await expect(page.locator('.route-head')).not.toContainText(/\bTo\b/)

  await page.getByRole('tab', { name: 'Street view' }).click()
  // 경로는 4호선 개찰구 → 공항철도 대합실 → 표 사는 곳, 정거장 3개(단계 2개)다
  const stops = page.locator('.stop-line li')
  const here = page.locator('.stop-line-here')
  await expect(stops).toHaveCount(3)
  await expect(page.locator('.stop-line ol')).toHaveAttribute('aria-label', '1 / 2')
  await expect(stops.nth(0)).toHaveClass('current')
  await expect.poll(async () => Math.round((await centerX(here)) - (await centerX(stops.nth(0))))).toBe(0)

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('.stop-line ol')).toHaveAttribute('aria-label', '2 / 2')
  await expect(stops.nth(0)).toHaveClass('done')
  await expect(stops.nth(1)).toHaveClass('current')
  await expect(stops.nth(2)).toHaveClass('')
  // 링은 노선 보기처럼 미끄러져 옮겨 가므로 다 옮겨 갈 때까지 기다린다
  await expect.poll(async () => Math.round((await centerX(here)) - (await centerX(stops.nth(1))))).toBe(0)
})
